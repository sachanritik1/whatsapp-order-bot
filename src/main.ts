import "dotenv/config";

import { Effect } from "effect";
import { makeAppRuntime } from "./app-layer.js";
import { startHttpServer } from "./http/server.js";
import { queueWorker } from "./worker/queue-worker.js";
import { logError } from "./logging.js";

const runtime = makeAppRuntime();

const main = async () => {
  const runningServer = await startHttpServer(runtime);
  runtime.runFork(queueWorker);

  const shutdown = async () => {
    await runningServer.close();
    await runtime.dispose();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
};

void main().catch((cause) => {
  logError("app.start.failed", { cause: String(cause) });
  void runtime.dispose().finally(() => process.exit(1));
});
