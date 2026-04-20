import { Context, Effect, Layer } from "effect";

import { AppConfigService } from "../config.js";
import { IntegrationError } from "../errors.js";
import { serializeForLog } from "../logging.js";
import { logInfo } from "../logging.js";

export interface WhatsAppClientShape {
  readonly sendText: (phone: string, text: string) => Effect.Effect<void, IntegrationError>;
}

export class WhatsAppClient extends Context.Tag("WhatsAppClient")<
  WhatsAppClient,
  WhatsAppClientShape
>() {}

const createPayload = (phone: string, text: string) => ({
  messaging_product: "whatsapp",
  to: phone,
  type: "text",
  text: {
    body: text
  }
});

export const WhatsAppClientLive = Layer.effect(
  WhatsAppClient,
  Effect.gen(function* () {
    const config = yield* AppConfigService;
    const hasCredentials =
      config.whatsappAccessToken !== null && config.whatsappPhoneNumberId !== null;

    return WhatsAppClient.of({
      sendText: (phone, text) =>
        hasCredentials
          ? Effect.tryPromise({
              try: async () => {
                const response = await fetch(
                  `https://graph.facebook.com/v22.0/${config.whatsappPhoneNumberId}/messages`,
                  {
                    method: "POST",
                    headers: {
                      "content-type": "application/json",
                      authorization: `Bearer ${config.whatsappAccessToken}`
                    },
                    body: JSON.stringify(createPayload(phone, text))
                  }
                );

                if (!response.ok) {
                  const responseBody = await response.text();
                  let parsedBody: unknown = responseBody;
                  try {
                    parsedBody = JSON.parse(responseBody);
                  } catch {
                    parsedBody = responseBody;
                  }

                  throw new IntegrationError({
                    service: "whatsapp",
                    message: `WhatsApp Cloud API ${response.status} ${response.statusText}`,
                    cause: {
                      status: response.status,
                      statusText: response.statusText,
                      phone,
                      response: parsedBody
                    }
                  });
                }

                logInfo("whatsapp.send.success", {
                  phone,
                  length: text.length
                });
              },
              catch: (cause) =>
                cause instanceof IntegrationError
                  ? cause
                  : new IntegrationError({
                      service: "whatsapp",
                      message: "WhatsApp Cloud API request failed.",
                      cause: serializeForLog(cause)
                    })
            })
          : Effect.sync(() => {
              logInfo("whatsapp.send.dry_run", { phone, text });
            })
    });
  })
);
