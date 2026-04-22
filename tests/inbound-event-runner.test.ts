import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { IntegrationError } from "../src/errors.js";
import { makeInboundEventRunner } from "../src/services/inbound-event-runner.js";

describe("inbound event runner", () => {
  it("marks non-retryable WhatsApp 4xx failures as failed", async () => {
    const statuses: string[] = [];

    const runner = makeInboundEventRunner({
      inboundEventRepo: {
        enqueue: (_messages) => Effect.void,
        claimNext: Effect.succeed({
          id: 1,
          phone: "919999999999",
          text: "Hello",
          messageId: "wamid.1",
          status: "processing" as const,
          attempts: 1,
          errorMessage: null,
          receivedAt: "2026-04-22T00:00:00.000Z",
          updatedAt: "2026-04-22T00:00:00.000Z"
        }),
        markProcessed: (_id: number) => Effect.sync(() => void statuses.push("processed")),
        markFailed: (_id: number, _errorMessage: string) =>
          Effect.sync(() => {
            statuses.push("failed");
            return "failed" as const;
          }),
        markRetryableFailure: (_id: number, _errorMessage: string) =>
          Effect.sync(() => {
            statuses.push("pending");
            return "pending" as const;
          }),
        list: Effect.succeed([])
      },
      conversationEngine: {
        handleEvent: (_event) =>
          Effect.fail(
            new IntegrationError({
              service: "whatsapp",
              message: "WhatsApp Cloud API 400 Bad Request",
              cause: { status: 400 }
            })
          )
      }
    });

    await Effect.runPromise(runner.runNext);

    expect(statuses).toEqual(["failed"]);
  });
});
