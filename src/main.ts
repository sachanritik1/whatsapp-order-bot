import "dotenv/config";

import { Effect, Fiber } from "effect";
import { makeAppRuntime } from "./app-layer.js";
import { startHttpServer } from "./http/server.js";
import { queueWorker } from "./worker/queue-worker.js";
import { logError } from "./logging.js";

const runtime = makeAppRuntime();

const main = async () => {
  const runningServer = await startHttpServer(runtime);
  const workerFiber = runtime.runFork(queueWorker);
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    await runtime.runPromise(Fiber.interrupt(workerFiber));
    await runningServer.close();
    await runtime.dispose();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
};

void main().catch((cause) => {
  logError("app.start.failed", { cause: String(cause) });
  void runtime.dispose().finally(() => process.exit(1));
});
