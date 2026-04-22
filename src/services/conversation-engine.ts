import { Context, Effect, Layer } from "effect";

import { IntegrationError } from "../errors.js";
import { logInfo } from "../logging.js";
import { containsAny, normalizeText } from "../lib/text.js";
import { type InboundEvent, type OrderSession, type TurnPlan } from "../schema.js";
import {
  CommerceTools,
  type CommerceToolsError,
  type CommerceToolsShape
} from "./commerce-tools.js";
import {
  OrderSessionWorkflow,
  type OrderSessionWorkflowError,
  type OrderSessionWorkflowShape
} from "./order-session-workflow.js";
import { TurnPlanner, type TurnPlannerShape } from "./turn-planner.js";
import { WhatsAppClient, type WhatsAppClientShape } from "./whatsapp-client.js";

export interface ConversationEngineShape {
  readonly handleEvent: (event: InboundEvent) => Effect.Effect<void, ConversationEngineError>;
}

export type ConversationEngineError =
  | CommerceToolsError
  | OrderSessionWorkflowError
  | IntegrationError;

export class ConversationEngine extends Context.Tag("ConversationEngine")<
  ConversationEngine,
  ConversationEngineShape
>() {}

interface ConversationEngineDependencies {
  readonly commerceTools: CommerceToolsShape;
  readonly turnPlanner: TurnPlannerShape;
  readonly sessionWorkflow: OrderSessionWorkflowShape;
  readonly whatsappClient: WhatsAppClientShape;
}

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

const executeRequestedTools = (
  deps: ConversationEngineDependencies,
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
              matches: [
                selectedProductDetails,
                ...productSearch.matches.filter((item) => item.id !== selectedProductDetails.id)
              ]
            }
          : productSearch,
      faqSearch
    };
  });

export const makeConversationEngine = (
  deps: ConversationEngineDependencies
): ConversationEngineShape => ({
  handleEvent: (event) =>
    Effect.gen(function* () {
      const { storedSession, planningSession } = yield* deps.sessionWorkflow.loadSessionSnapshot(
        event.phone
      );

      const initialPlan = yield* deps.turnPlanner.planTurn({
        userMessage: event.text,
        session: planningSession
      });

      const toolResults = yield* executeRequestedTools(deps, event, planningSession, initialPlan);

      const rawFinalPlan = yield* deps.turnPlanner.planTurn({
        userMessage: event.text,
        session: planningSession,
        ...toolResults
      });
      const finalPlan = applyConversationGuardrails(event, storedSession, rawFinalPlan);

      logInfo("worker.intent", {
        messageId: event.messageId,
        intent: finalPlan.intent,
        action: finalPlan.action,
        provider: finalPlan.provider
      });

      const lead = yield* deps.sessionWorkflow.advanceConversation(
        event,
        planningSession,
        finalPlan
      );

      if (lead) {
        logInfo("lead.created", {
          leadId: lead.id,
          phone: event.phone
        });
      }

      yield* deps.whatsappClient.sendText(event.phone, finalPlan.replyText);
    })
});

export const ConversationEngineLive = Layer.effect(
  ConversationEngine,
  Effect.gen(function* () {
    const commerceTools = yield* CommerceTools;
    const turnPlanner = yield* TurnPlanner;
    const sessionWorkflow = yield* OrderSessionWorkflow;
    const whatsappClient = yield* WhatsAppClient;

    return ConversationEngine.of(
      makeConversationEngine({
        commerceTools,
        turnPlanner,
        sessionWorkflow,
        whatsappClient
      })
    );
  })
);
