import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makeConversationEngine } from "../src/services/conversation-engine.js";
import type { OrderSession, TurnPlan } from "../src/schema.js";

const completedSession: OrderSession = {
  phone: "919999999999",
  name: "Riya",
  product: "Protein Granola",
  quantity: 2,
  cityOrPincode: "560001",
  selectedProductId: "granola-1",
  candidateProductIds: ["granola-1"],
  missingFields: [],
  lastAskedFollowUp: null,
  clarificationCount: 0,
  status: "completed",
  updatedAt: "2026-04-22T00:00:00.000Z"
};

const confirmPlan: TurnPlan = {
  intent: "order_intent",
  action: "confirm_order",
  extractedFields: {
    name: null,
    productQuery: null,
    quantity: null,
    cityOrPincode: null
  },
  missingFields: [],
  selectedProductId: null,
  requestedTools: [],
  replyText: "Thanks, your order is confirmed.",
  confidence: 0.8,
  provider: "heuristic"
};

describe("conversation engine", () => {
  it("applies completed-session greeting guardrails before persisting or sending", async () => {
    const plannedActions: string[] = [];
    const sentMessages: Array<{ phone: string; text: string }> = [];
    const advancedPlans: TurnPlan[] = [];

    const engine = makeConversationEngine({
      commerceTools: {
        listCatalog: (_limit: number) => Effect.die("not used"),
        searchProducts: (_query: string, _limit: number, _includeAlternatives: boolean) =>
          Effect.die("not used"),
        getProductDetails: (_productIdOrName: string) => Effect.die("not used"),
        searchFaq: (_query: string) => Effect.die("not used"),
        getSession: (_phone: string) => Effect.die("not used"),
        updateSession: (_input) => Effect.die("not used"),
        createLeadFromSession: (_input) => Effect.die("not used")
      },
      turnPlanner: {
        planTurn: (_input) =>
          Effect.sync(() => {
            plannedActions.push("confirm_order");
            return confirmPlan;
          })
      },
      sessionWorkflow: {
        loadSessionSnapshot: (_phone: string) =>
          Effect.succeed({
            storedSession: completedSession,
            planningSession: null
          }),
        advanceConversation: (_event, _previousSession, finalPlan) =>
          Effect.sync(() => {
            advancedPlans.push(finalPlan);
            return null;
          })
      },
      whatsappClient: {
        sendText: (phone: string, text: string) =>
          Effect.sync(() => {
            sentMessages.push({ phone, text });
          })
      }
    });

    await Effect.runPromise(
      engine.handleEvent({
        id: 1,
        phone: completedSession.phone,
        text: "Hi",
        messageId: "wamid.greeting",
        status: "processing",
        attempts: 1,
        errorMessage: null,
        receivedAt: "2026-04-22T00:00:00.000Z",
        updatedAt: "2026-04-22T00:00:00.000Z"
      })
    );

    expect(plannedActions).toHaveLength(2);
    expect(advancedPlans).toHaveLength(1);
    expect(advancedPlans[0]?.action).toBe("greet_user");
    expect(sentMessages[0]?.phone).toBe(completedSession.phone);
    expect(sentMessages[0]?.text).toContain("Hi Riya!");
  });
});
