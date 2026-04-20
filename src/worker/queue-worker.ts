import { Cause, Effect, Option } from "effect";

import { IntegrationError } from "../errors.js";
import { InboundEventRepo } from "../repos/inbound-event-repo.js";
import { MessageProcessor } from "../services/message-processor.js";
import { logError } from "../logging.js";

const processOne = Effect.gen(function* () {
  const inboundEventRepo = yield* InboundEventRepo;
  const messageProcessor = yield* MessageProcessor;
  const event = yield* inboundEventRepo.claimNext;

  if (!event) {
    yield* Effect.sleep("250 millis");
    return;
  }

  const exit = yield* Effect.exit(messageProcessor.processEvent(event));

  if (exit._tag === "Success") {
    yield* inboundEventRepo.markProcessed(event.id);
    return;
  }

  const errorMessage = Cause.pretty(exit.cause);

  const failureOption = Cause.failureOption(exit.cause);
  const isNonRetryableWhatsAppFailure = Option.match(failureOption, {
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

  const status = isNonRetryableWhatsAppFailure
    ? yield* inboundEventRepo.markFailed(event.id, errorMessage)
    : yield* inboundEventRepo.markRetryableFailure(event.id, errorMessage);

  yield* Effect.sync(() => {
    logError("worker.process.failed", {
      messageId: event.messageId,
      status,
      errorMessage
    });
  });
});

export const queueWorker = processOne.pipe(
  Effect.catchAllCause((cause) =>
    Effect.gen(function* () {
      yield* Effect.sync(() => {
        logError("worker.loop.failed", {
          cause: Cause.pretty(cause)
        });
      });
      yield* Effect.sleep("500 millis");
    })
  ),
  Effect.forever
);
