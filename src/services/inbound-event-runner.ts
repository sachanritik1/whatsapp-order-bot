import { Cause, Context, Effect, Layer, Option } from "effect";

import { DatabaseError, IntegrationError } from "../errors.js";
import { logError } from "../logging.js";
import { InboundEventRepo, type InboundEventRepoShape } from "../repos/inbound-event-repo.js";
import {
  ConversationEngine,
  type ConversationEngineError,
  type ConversationEngineShape
} from "./conversation-engine.js";

export interface InboundEventRunnerShape {
  readonly runNext: Effect.Effect<void, InboundEventRunnerError>;
}

export type InboundEventRunnerError = DatabaseError | ConversationEngineError;

export class InboundEventRunner extends Context.Tag("InboundEventRunner")<
  InboundEventRunner,
  InboundEventRunnerShape
>() {}

interface InboundEventRunnerDependencies {
  readonly inboundEventRepo: InboundEventRepoShape;
  readonly conversationEngine: ConversationEngineShape;
}

const isNonRetryableWhatsAppFailure = (cause: Cause.Cause<unknown>): boolean => {
  const failureOption = Cause.failureOption(cause);
  return Option.match(failureOption, {
    onNone: () => false,
    onSome: (failure) => {
      if (!(failure instanceof IntegrationError) || failure.service !== "whatsapp") {
        return false;
      }

      if (typeof failure.cause !== "object" || failure.cause === null) {
        return false;
      }

      const status = (failure.cause as { readonly status?: unknown }).status;
      return typeof status === "number" && status >= 400 && status < 500 && status !== 429;
    }
  });
};

export const makeInboundEventRunner = (
  deps: InboundEventRunnerDependencies
): InboundEventRunnerShape => ({
  runNext: Effect.gen(function* () {
    const event = yield* deps.inboundEventRepo.claimNext;

    if (!event) {
      yield* Effect.sleep("250 millis");
      return;
    }

    const exit = yield* Effect.exit(deps.conversationEngine.handleEvent(event));

    if (exit._tag === "Success") {
      yield* deps.inboundEventRepo.markProcessed(event.id);
      return;
    }

    const errorMessage = Cause.pretty(exit.cause);
    const status = isNonRetryableWhatsAppFailure(exit.cause)
      ? yield* deps.inboundEventRepo.markFailed(event.id, errorMessage)
      : yield* deps.inboundEventRepo.markRetryableFailure(event.id, errorMessage);

    yield* Effect.sync(() => {
      logError("worker.process.failed", {
        messageId: event.messageId,
        status,
        errorMessage
      });
    });
  })
});

export const InboundEventRunnerLive = Layer.effect(
  InboundEventRunner,
  Effect.gen(function* () {
    const inboundEventRepo = yield* InboundEventRepo;
    const conversationEngine = yield* ConversationEngine;

    return InboundEventRunner.of(
      makeInboundEventRunner({
        inboundEventRepo,
        conversationEngine
      })
    );
  })
);
