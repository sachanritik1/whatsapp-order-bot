import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeOrderSessionWorkflow,
  type SessionSnapshot
} from "../src/services/order-session-workflow.js";
import type { Lead, OrderSession, TurnPlan } from "../src/schema.js";
import type { SaveOrderSessionInput } from "../src/repos/order-session-repo.js";

const basePlan: TurnPlan = {
  intent: "order_intent",
  action: "confirm_order",
  extractedFields: {
    name: "Riya",
    productQuery: "Protein Granola",
    quantity: 2,
    cityOrPincode: "560001"
  },
  missingFields: [],
  selectedProductId: "granola-1",
  requestedTools: [],
  replyText: "Thanks Riya. I have your order.",
  confidence: 0.95,
  provider: "heuristic"
};

const openSession: OrderSession = {
  phone: "919999999999",
  name: "Riya",
  product: "Protein Granola",
  quantity: 2,
  cityOrPincode: null,
  selectedProductId: "granola-1",
  candidateProductIds: ["granola-1"],
  missingFields: ["cityOrPincode"],
  lastAskedFollowUp: "Please share your city or pincode.",
  clarificationCount: 1,
  status: "open",
  updatedAt: "2026-04-22T00:00:00.000Z"
};

describe("order session workflow", () => {
  it("exposes an open session for planning but hides completed ones", async () => {
    let storedSession: OrderSession | null = openSession;

    const workflow = makeOrderSessionWorkflow({
      orderSessionRepo: {
        getByPhone: () => Effect.succeed(storedSession),
        save: (_input: SaveOrderSessionInput) => Effect.die("not used"),
        clear: (_phone: string) => Effect.void
      },
      leadRepo: {
        create: (_input) => Effect.die("not used"),
        findBySourceMessageId: (_messageId: string) => Effect.succeed(null),
        list: Effect.succeed([])
      }
    });

    const openSnapshot = await Effect.runPromise(
      workflow.loadSessionSnapshot(openSession.phone)
    );
    expect(openSnapshot).toEqual<SessionSnapshot>({
      storedSession: openSession,
      planningSession: openSession
    });

    storedSession = { ...openSession, status: "completed" };

    const completedSnapshot = await Effect.runPromise(
      workflow.loadSessionSnapshot(openSession.phone)
    );
    expect(completedSnapshot.storedSession?.status).toBe("completed");
    expect(completedSnapshot.planningSession).toBeNull();
  });

  it("persists a completed session and creates the lead only once", async () => {
    let savedSession: OrderSession | null = null;
    const leadsByMessageId = new Map<string, Lead>();
    let leadId = 1;

    const workflow = makeOrderSessionWorkflow({
      orderSessionRepo: {
        getByPhone: () => Effect.succeed(savedSession),
        save: (input: SaveOrderSessionInput) =>
          Effect.sync(() => {
            savedSession = {
              ...input,
              updatedAt: "2026-04-22T01:00:00.000Z"
            };
            return savedSession!;
          }),
        clear: (_phone: string) => Effect.void
      },
      leadRepo: {
        findBySourceMessageId: (sourceMessageId: string) =>
          Effect.succeed(leadsByMessageId.get(sourceMessageId) ?? null),
        create: (input) =>
          Effect.sync(() => {
            const lead: Lead = {
              id: leadId++,
              createdAt: "2026-04-22T01:00:01.000Z",
              ...input
            };
            leadsByMessageId.set(input.sourceMessageId, lead);
            return lead;
          }),
        list: Effect.succeed([])
      }
    });

    const event = {
      id: 1,
      phone: openSession.phone,
      text: "My pincode is 560001",
      messageId: "wamid.1",
      status: "processing" as const,
      attempts: 1,
      errorMessage: null,
      receivedAt: "2026-04-22T01:00:00.000Z",
      updatedAt: "2026-04-22T01:00:00.000Z"
    };

    const firstLead = await Effect.runPromise(
      workflow.advanceConversation(event, openSession, basePlan)
    );
    const secondLead = await Effect.runPromise(
      workflow.advanceConversation(event, openSession, basePlan)
    );

    expect(savedSession?.status).toBe("completed");
    expect(savedSession?.cityOrPincode).toBe("560001");
    expect(firstLead?.id).toBe(1);
    expect(secondLead?.id).toBe(1);
    expect(leadsByMessageId.size).toBe(1);
  });
});
