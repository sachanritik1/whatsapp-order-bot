import { Context, Effect, Layer } from "effect";

import { IntegrationError } from "../errors.js";
import { logInfo } from "../logging.js";
import { containsAny, normalizeText } from "../lib/text.js";
import {
  CommerceTools,
  type CommerceToolsError,
  type CommerceToolsShape
} from "./commerce-tools.js";
import { LLMService, type LLMServiceShape } from "./llm-service.js";
import { WhatsAppClient, type WhatsAppClientShape } from "./whatsapp-client.js";
import {
  type InboundEvent,
  type OrderSession,
  type TurnPlan
} from "../schema.js";

export interface MessageProcessorShape {
  readonly processEvent: (event: InboundEvent) => Effect.Effect<void, MessageProcessorError>;
}

export type MessageProcessorError = CommerceToolsError | IntegrationError;

export class MessageProcessor extends Context.Tag("MessageProcessor")<
  MessageProcessor,
  MessageProcessorShape
>() {}

interface ProcessorDependencies {
  readonly commerceTools: CommerceToolsShape;
  readonly llmService: LLMServiceShape;
  readonly whatsappClient: WhatsAppClientShape;
}

const shouldPersistSession = (plan: TurnPlan): boolean =>
  plan.action === "collect_order_details" || plan.action === "reset_order";

const shouldDiscardExistingSession = (plan: TurnPlan): boolean =>
  plan.intent === "new_order" || plan.action === "reset_order";

const planningSessionFor = (session: OrderSession | null): OrderSession | null =>
  session?.status === "open" ? session : null;

const hasFreshOrderSignal = (text: string): boolean =>
  containsAny(normalizeText(text), [
    "order",
    "buy",
    "purchase",
    "want",
    "need",
    "new order",
    "new product",
    "different product",
    "change product"
  ]);

const isGreetingOnly = (text: string): boolean =>
  containsAny(normalizeText(text), ["hi", "hello", "hey", "good morning", "good afternoon", "good evening"]) &&
  !hasFreshOrderSignal(text);

const applyConversationGuardrails = (
  event: InboundEvent,
  session: OrderSession | null,
  plan: TurnPlan
): TurnPlan => {
  const completedSession = session?.status === "completed" ? session : null;

  if (completedSession && isGreetingOnly(event.text)) {
    return {
      ...plan,
      intent: "greeting",
      action: "greet_user",
      missingFields: [],
      requestedTools: [],
      selectedProductId: null,
      replyText: completedSession.name
        ? `Hi ${completedSession.name}! I can help you browse products, check prices, answer shipping questions, or start a new order.`
        : "Hi! I can help you browse products, check prices, answer shipping questions, or start a new order."
    };
  }

  if (completedSession && !hasFreshOrderSignal(event.text) && plan.action === "confirm_order") {
    return {
      ...plan,
      intent: "clarify",
      action: "clarify_request",
      missingFields: [],
      requestedTools: [],
      selectedProductId: null,
      replyText: "I can help you browse products, check prices, answer shipping questions, or start a new order. What would you like to do?"
    };
  }

  return plan;
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
  missingFields: plan.missingFields,
  lastAskedFollowUp:
    plan.action === "collect_order_details" ? plan.replyText : session?.lastAskedFollowUp ?? null,
  clarificationCount:
    plan.action === "collect_order_details"
      ? (session?.clarificationCount ?? 0) + 1
      : session?.clarificationCount ?? 0,
  status: plan.action === "confirm_order" ? "completed" as const : "open" as const
});

const executeRequestedTools = (
  deps: ProcessorDependencies,
  event: InboundEvent,
  session: OrderSession | null,
  plan: TurnPlan
) =>
  Effect.gen(function* () {
    const requestedNames = new Set(plan.requestedTools.map((tool) => tool.name));

    const productSearch =
      requestedNames.has("listCatalog")
        ? yield* deps.commerceTools.listCatalog(4)
        : requestedNames.has("searchProducts") || requestedNames.has("getProductDetails")
          ? yield* deps.commerceTools.searchProducts(event.text, 3, true)
        : null;

    const faqSearch = requestedNames.has("searchFaq")
      ? yield* deps.commerceTools.searchFaq(event.text)
      : null;

    const selectedProductId =
      plan.selectedProductId ?? productSearch?.matches.at(0)?.id ?? session?.selectedProductId ?? null;
    const selectedProductDetails =
      requestedNames.has("getProductDetails") && selectedProductId
        ? yield* deps.commerceTools.getProductDetails(selectedProductId)
        : null;

    return {
      productSearch:
        selectedProductDetails && productSearch
          ? {
              ...productSearch,
              matches: [selectedProductDetails, ...productSearch.matches.filter((item) => item.id !== selectedProductDetails.id)]
            }
          : productSearch,
      faqSearch
    };
  });

const persistOpenSession = (
  deps: ProcessorDependencies,
  event: InboundEvent,
  previousSession: OrderSession | null,
  finalPlan: TurnPlan
) =>
  Effect.gen(function* () {
    const nextState = mergeSessionState(
      shouldDiscardExistingSession(finalPlan) ? null : previousSession,
      finalPlan
    );
    yield* deps.commerceTools.updateSession({
      ...nextState,
      phone: event.phone
    });
  });

const maybeCreateLead = (
  deps: ProcessorDependencies,
  event: InboundEvent,
  previousSession: OrderSession | null,
  finalPlan: TurnPlan
) =>
  Effect.gen(function* () {
    if (finalPlan.action !== "confirm_order") {
      if (shouldPersistSession(finalPlan)) {
        yield* persistOpenSession(deps, event, previousSession, finalPlan);
      }
      return null;
    }

    yield* deps.commerceTools.updateSession({
      ...mergeSessionState(
        shouldDiscardExistingSession(finalPlan) ? null : previousSession,
        finalPlan
      ),
      phone: event.phone,
      status: "completed",
      lastAskedFollowUp: null,
      clarificationCount: previousSession?.clarificationCount ?? 0
    });

    return yield* deps.commerceTools.createLeadFromSession({
      phone: event.phone,
      sourceMessageId: event.messageId
    });
  });

export const MessageProcessorLive = Layer.effect(
  MessageProcessor,
  Effect.gen(function* () {
    const commerceTools = yield* CommerceTools;
    const llmService = yield* LLMService;
    const whatsappClient = yield* WhatsAppClient;

    const deps: ProcessorDependencies = {
      commerceTools,
      llmService,
      whatsappClient
    };

    return MessageProcessor.of({
      processEvent: (event) =>
        Effect.gen(function* () {
          const session = yield* commerceTools.getSession(event.phone);
          const planningSession = planningSessionFor(session);

          const initialPlan = yield* llmService.planTurn({
            userMessage: event.text,
            session: planningSession
          });

          const toolResults = yield* executeRequestedTools(deps, event, planningSession, initialPlan);

          const rawFinalPlan = yield* llmService.planTurn({
            userMessage: event.text,
            session: planningSession,
            ...toolResults
          });
          const finalPlan = applyConversationGuardrails(event, session, rawFinalPlan);

          logInfo("worker.intent", {
            messageId: event.messageId,
            intent: finalPlan.intent,
            action: finalPlan.action,
            provider: finalPlan.provider
          });

          const lead = yield* maybeCreateLead(deps, event, planningSession, finalPlan);

          if (lead) {
            logInfo("lead.created", {
              leadId: lead.leadId,
              phone: event.phone
            });
          }

          yield* whatsappClient.sendText(event.phone, finalPlan.replyText);
        })
    });
  })
);
