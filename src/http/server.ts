import { HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Option, Schema } from "effect";
import { createServer, type Server } from "node:http";

import type { AppRuntime } from "../app-layer.js";
import { AppConfigService } from "../config.js";
import { logError, logInfo, logWarn } from "../logging.js";
import { InboundEventRepo } from "../repos/inbound-event-repo.js";
import {
  InboundMessageSchema,
  WhatsAppWebhookPayloadSchema,
  type AppConfig,
  type InboundMessage
} from "../schema.js";

const decodeWebhookPayload = Schema.decodeUnknownSync(WhatsAppWebhookPayloadSchema);
const decodeInboundMessage = Schema.decodeUnknownSync(InboundMessageSchema);

export interface RunningServer {
  readonly server: Server;
  readonly port: number;
  readonly close: () => Promise<void>;
}

const receivedResponse = HttpServerResponse.unsafeJson({ received: true });
const retryableFailureResponse = HttpServerResponse.unsafeJson(
  { received: false },
  { status: 503 }
);
const notFoundResponse = HttpServerResponse.unsafeJson(
  { error: "Not found" },
  { status: 404 }
);
const forbiddenResponse = HttpServerResponse.text("Forbidden", { status: 403 });

const readQueryParam = (value: string | ReadonlyArray<string> | undefined): string | null => {
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
  searchParams: Readonly<Record<string, string | Array<string>>>,
  config: AppConfig
) => {
  const mode = readQueryParam(searchParams["hub.mode"]);
  const token = readQueryParam(searchParams["hub.verify_token"]);
  const challenge = readQueryParam(searchParams["hub.challenge"]);

  if (mode === "subscribe" && token === config.webhookVerifyToken && challenge) {
    return HttpServerResponse.text(challenge, {
      status: 200,
      contentType: "text/plain"
    });
  }

  return forbiddenResponse;
};

const handleWebhookPost = (
  runtime: AppRuntime
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, HttpServerRequest.HttpServerRequest> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const parsedPayload = yield* Effect.either(request.json);

    if (parsedPayload._tag === "Left") {
      logWarn("webhook.invalid_json", {
        reason: "Effect request JSON parser rejected request body."
      });
      return receivedResponse;
    }

    let decodedPayload: ReturnType<typeof decodeWebhookPayload>;

    try {
      decodedPayload = decodeWebhookPayload(parsedPayload.right);
    } catch (cause) {
      logWarn("webhook.ignored", {
        reason: "Invalid or unsupported payload.",
        cause: String(cause)
      });
      return receivedResponse;
    }

    const messages = extractInboundMessages(decodedPayload);
    if (messages.length === 0) {
      logInfo("webhook.ignored_non_message", {
        reason: "Payload did not include inbound text messages."
      });
      return receivedResponse;
    }

    logInfo("webhook.received", { messageCount: messages.length });

    const enqueueResult = yield* Effect.either(
      Effect.tryPromise({
        try: () =>
          runtime.runPromise(
            Effect.gen(function* () {
              const repo = yield* InboundEventRepo;
              yield* repo.enqueue(messages);
            })
          ),
        catch: (cause) => cause
      })
    );

    if (enqueueResult._tag === "Left") {
      logError("webhook.enqueue.failed", {
        reason: "Inbound event enqueue failed. Returning 503 so webhook provider can retry.",
        messageCount: messages.length,
        cause: String(enqueueResult.left)
      });
      return retryableFailureResponse;
    }

    for (const message of messages) {
      logInfo("queue.enqueued", {
        messageId: message.messageId,
        phone: message.phone
      });
    }

    return receivedResponse;
  });

const handleWebhookGet = (
  config: AppConfig
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, HttpServerRequest.HttpServerRequest> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);

    if (Option.isNone(url)) {
      return forbiddenResponse;
    }

    return handleVerification(HttpServerRequest.searchParamsFromURL(url.value), config);
  });

export const buildHttpApp = (
  runtime: AppRuntime,
  config: AppConfig
): HttpRouter.HttpRouter =>
  HttpRouter.empty.pipe(
    HttpRouter.get("/webhook", handleWebhookGet(config)),
    HttpRouter.post("/webhook", handleWebhookPost(runtime)),
    HttpRouter.all("*", notFoundResponse)
  );

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
  const app = buildHttpApp(runtime, config);
  const server = createServer();
  const handler = await Effect.runPromise(NodeHttpServer.makeHandler(app));

  server.on("request", handler);

  await new Promise<void>((resolve) => {
    server.listen(port, resolve);
  });

  const address = server.address();
  const resolvedPort =
    typeof address === "object" && address !== null ? address.port : port;

  logInfo("server.started", { port: resolvedPort });

  return {
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
