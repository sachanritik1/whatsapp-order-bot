import { Cause, Effect } from "effect";

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
  const status = yield* inboundEventRepo.markRetryableFailure(event.id, errorMessage);

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
