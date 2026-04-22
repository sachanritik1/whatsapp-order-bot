import { Cause, Effect } from "effect";

import { InboundEventRunner } from "../services/inbound-event-runner.js";
import { logError } from "../logging.js";

const processOne = Effect.gen(function* () {
  const inboundEventRunner = yield* InboundEventRunner;
  yield* inboundEventRunner.runNext;
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
