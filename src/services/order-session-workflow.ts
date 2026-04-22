import { Context, Effect, Layer } from "effect";

import { DatabaseError, OrderSessionIncompleteError } from "../errors.js";
import { LeadRepo, type LeadRepoShape } from "../repos/lead-repo.js";
import { OrderSessionRepo, type OrderSessionRepoShape } from "../repos/order-session-repo.js";
import type { InboundEvent, Lead, OrderSession, TurnPlan } from "../schema.js";

export interface SessionSnapshot {
  readonly storedSession: OrderSession | null;
  readonly planningSession: OrderSession | null;
}

export interface OrderSessionWorkflowShape {
  readonly loadSessionSnapshot: (
    phone: string
  ) => Effect.Effect<SessionSnapshot, DatabaseError>;
  readonly advanceConversation: (
    event: InboundEvent,
    previousSession: OrderSession | null,
    finalPlan: TurnPlan
  ) => Effect.Effect<Lead | null, OrderSessionWorkflowError>;
}

export type OrderSessionWorkflowError = DatabaseError | OrderSessionIncompleteError;

export class OrderSessionWorkflow extends Context.Tag("OrderSessionWorkflow")<
  OrderSessionWorkflow,
  OrderSessionWorkflowShape
>() {}

interface WorkflowDependencies {
  readonly orderSessionRepo: OrderSessionRepoShape;
  readonly leadRepo: LeadRepoShape;
}

const shouldPersistSession = (plan: TurnPlan): boolean =>
  plan.action === "collect_order_details" || plan.action === "reset_order";

const shouldDiscardExistingSession = (plan: TurnPlan): boolean =>
  plan.intent === "new_order" || plan.action === "reset_order";

const planningSessionFor = (session: OrderSession | null): OrderSession | null =>
  session?.status === "open" ? session : null;

const missingFieldsFor = (session: {
  readonly name: string | null;
  readonly product: string | null;
  readonly quantity: number | null;
  readonly cityOrPincode: string | null;
}): ReadonlyArray<"name" | "product" | "quantity" | "cityOrPincode"> => {
  const missing: Array<"name" | "product" | "quantity" | "cityOrPincode"> = [];
  if (!session.name) missing.push("name");
  if (!session.product) missing.push("product");
  if (!session.quantity) missing.push("quantity");
  if (!session.cityOrPincode) missing.push("cityOrPincode");
  return missing;
};

const mergeSessionState = (
  session: OrderSession | null,
  plan: TurnPlan
) => ({
  phone: session?.phone ?? "",
  name: plan.extractedFields.name ?? session?.name ?? null,
  product: plan.extractedFields.productQuery ?? session?.product ?? null,
  quantity: plan.extractedFields.quantity ?? session?.quantity ?? null,
  cityOrPincode: plan.extractedFields.cityOrPincode ?? session?.cityOrPincode ?? null,
  selectedProductId: plan.selectedProductId ?? session?.selectedProductId ?? null,
  candidateProductIds:
    plan.selectedProductId !== null
      ? [plan.selectedProductId]
      : session?.candidateProductIds ?? [],
  missingFields:
    plan.missingFields.length > 0
      ? plan.missingFields
      : missingFieldsFor({
          name: plan.extractedFields.name ?? session?.name ?? null,
          product: plan.extractedFields.productQuery ?? session?.product ?? null,
          quantity: plan.extractedFields.quantity ?? session?.quantity ?? null,
          cityOrPincode: plan.extractedFields.cityOrPincode ?? session?.cityOrPincode ?? null
        }),
  lastAskedFollowUp:
    plan.action === "collect_order_details" ? plan.replyText : session?.lastAskedFollowUp ?? null,
  clarificationCount:
    plan.action === "collect_order_details"
      ? (session?.clarificationCount ?? 0) + 1
      : session?.clarificationCount ?? 0,
  status: plan.action === "confirm_order" ? "completed" as const : "open" as const
});

const persistSessionState = (
  deps: WorkflowDependencies,
  event: InboundEvent,
  previousSession: OrderSession | null,
  finalPlan: TurnPlan,
  statusOverride?: "open" | "completed"
) =>
  Effect.gen(function* () {
    const nextState = mergeSessionState(
      shouldDiscardExistingSession(finalPlan) ? null : previousSession,
      finalPlan
    );

    return yield* deps.orderSessionRepo.save({
      ...nextState,
      phone: event.phone,
      status: statusOverride ?? nextState.status
    });
  });

export const makeOrderSessionWorkflow = (
  deps: WorkflowDependencies
): OrderSessionWorkflowShape => ({
  loadSessionSnapshot: (phone) =>
    Effect.gen(function* () {
      const storedSession = yield* deps.orderSessionRepo.getByPhone(phone);
      return {
        storedSession,
        planningSession: planningSessionFor(storedSession)
      };
    }),
  advanceConversation: (event, previousSession, finalPlan) =>
    Effect.gen(function* () {
      if (finalPlan.action !== "confirm_order") {
        if (shouldPersistSession(finalPlan)) {
          yield* persistSessionState(deps, event, previousSession, finalPlan);
        }
        return null;
      }

      const persistedSession = yield* persistSessionState(
        deps,
        event,
        previousSession,
        finalPlan,
        "completed"
      );
      const existingLead = yield* deps.leadRepo.findBySourceMessageId(event.messageId);

      if (existingLead) {
        return existingLead;
      }

      if (
        !persistedSession.name ||
        !persistedSession.product ||
        !persistedSession.quantity ||
        !persistedSession.cityOrPincode
      ) {
        return yield* Effect.fail(
          new OrderSessionIncompleteError({
            phone: event.phone,
            message: "Cannot create lead from incomplete order session."
          })
        );
      }

      return yield* deps.leadRepo.create({
        sourceMessageId: event.messageId,
        phone: event.phone,
        name: persistedSession.name,
        product: persistedSession.product,
        quantity: persistedSession.quantity,
        cityOrPincode: persistedSession.cityOrPincode
      });
    })
});

export const OrderSessionWorkflowLive = Layer.effect(
  OrderSessionWorkflow,
  Effect.gen(function* () {
    const orderSessionRepo = yield* OrderSessionRepo;
    const leadRepo = yield* LeadRepo;

    return OrderSessionWorkflow.of(
      makeOrderSessionWorkflow({
        orderSessionRepo,
        leadRepo
      })
    );
  })
);
