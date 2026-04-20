import { Effect, Schema } from "effect";
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type Response
} from "express";
import { createServer, type Server } from "node:http";

import { AppConfigService } from "../config.js";
import { logError, logInfo, logWarn } from "../logging.js";
import type { AppRuntime } from "../app-layer.js";
import {
  InboundMessageSchema,
  WhatsAppWebhookPayloadSchema,
  type AppConfig,
  type InboundMessage
} from "../schema.js";
import { InboundEventRepo } from "../repos/inbound-event-repo.js";

const decodeWebhookPayload = Schema.decodeUnknownSync(WhatsAppWebhookPayloadSchema);
const decodeInboundMessage = Schema.decodeUnknownSync(InboundMessageSchema);

export interface RunningServer {
  readonly app: Express;
  readonly server: Server;
  readonly port: number;
  readonly close: () => Promise<void>;
}

const sendReceived = (response: Response) => {
  response.status(200).json({ received: true });
};

const sendRetryableFailure = (response: Response) => {
  response.status(503).json({ received: false });
};

const readQueryParam = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return null;
};

const extractInboundMessages = (
  payload: ReturnType<typeof decodeWebhookPayload>
): ReadonlyArray<InboundMessage> =>
  payload.entry.flatMap((entry) =>
    entry.changes.flatMap((change) =>
      change.value.messages.map((message) =>
        decodeInboundMessage({
          phone: message.from,
          text: message.text.body,
          messageId: message.id,
          receivedAt: new Date(Number(message.timestamp) * 1000).toISOString()
        })
      )
    )
  );

const handleVerification = (
  request: Request,
  response: Response,
  config: AppConfig
) => {
  const mode = readQueryParam(request.query["hub.mode"]);
  const token = readQueryParam(request.query["hub.verify_token"]);
  const challenge = readQueryParam(request.query["hub.challenge"]);

  if (mode === "subscribe" && token === config.webhookVerifyToken && challenge) {
    response.status(200).type("text/plain").send(challenge);
    return;
  }

  response.status(403).type("text/plain").send("Forbidden");
};

const handleWebhookPost = async (
  runtime: AppRuntime,
  payload: unknown,
  response: Response
) => {
  let decodedPayload: ReturnType<typeof decodeWebhookPayload>;

  try {
    decodedPayload = decodeWebhookPayload(payload);
  } catch (cause) {
    logWarn("webhook.ignored", {
      reason: "Invalid or unsupported payload.",
      cause: String(cause)
    });
    sendReceived(response);
    return;
  }

  const messages = extractInboundMessages(decodedPayload);
  if (messages.length === 0) {
    logInfo("webhook.ignored_non_message", {
      reason: "Payload did not include inbound text messages."
    });
    sendReceived(response);
    return;
  }

  logInfo("webhook.received", { messageCount: messages.length });

  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const repo = yield* InboundEventRepo;
        yield* repo.enqueue(messages);
      })
    );

    for (const message of messages) {
      logInfo("queue.enqueued", {
        messageId: message.messageId,
        phone: message.phone
      });
    }

    sendReceived(response);
  } catch (cause) {
    logError("webhook.enqueue.failed", {
      reason: "Inbound event enqueue failed. Returning 503 so webhook provider can retry.",
      messageCount: messages.length,
      cause: String(cause)
    });
    sendRetryableFailure(response);
  }
};

export const buildExpressApp = (
  runtime: AppRuntime,
  config: AppConfig
): Express => {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/webhook", (request, response) => {
    handleVerification(request, response, config);
  });

  app.post("/webhook", async (request, response) => {
    await handleWebhookPost(runtime, request.body, response);
  });

  const invalidJsonHandler: ErrorRequestHandler = (error, _request, response, next) => {
    if (
      error instanceof SyntaxError ||
      (typeof error === "object" &&
        error !== null &&
        "type" in error &&
        error.type === "entity.parse.failed")
    ) {
      logWarn("webhook.invalid_json", {
        reason: "Express JSON parser rejected request body."
      });
      sendReceived(response);
      return;
    }

    next(error);
  };

  app.use(invalidJsonHandler);

  app.use((_request, response) => {
    response.status(404).json({ error: "Not found" });
  });

  return app;
};

export const startHttpServer = async (
  runtime: AppRuntime,
  portOverride?: number
): Promise<RunningServer> => {
  const config = await runtime.runPromise(
    Effect.gen(function* () {
      return yield* AppConfigService;
    })
  );
  const port = portOverride ?? config.port;
  const app = buildExpressApp(runtime, config);
  const server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(port, resolve);
  });

  const address = server.address();
  const resolvedPort =
    typeof address === "object" && address !== null ? address.port : port;

  logInfo("server.started", { port: resolvedPort });

  return {
    app,
    server,
    port: resolvedPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      })
  };
};
