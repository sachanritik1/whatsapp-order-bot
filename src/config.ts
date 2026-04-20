import { Context, Effect, Layer, Schema } from "effect";
import { resolve } from "node:path";

import { ConfigError } from "./errors.js";
import { AppConfigSchema, type AppConfig } from "./schema.js";

const decodeAppConfig = Schema.decodeUnknownSync(AppConfigSchema);

const loadConfig = Effect.try({
  try: () =>
    decodeAppConfig({
      port: Number(process.env.PORT ?? "3000"),
      webhookVerifyToken: process.env.WEBHOOK_VERIFY_TOKEN,
      whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || null,
      whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
      llmProvider: process.env.LLM_PROVIDER || null,
      openRouterApiKey: process.env.OPENROUTER_API_KEY || null,
      openRouterModel: process.env.OPENROUTER_MODEL || null,
      googleGeminiApiKey: process.env.GOOGLE_GEMINI_API_KEY || null,
      googleGeminiModel: process.env.GOOGLE_GEMINI_MODEL || null,
      databaseFile: resolve(process.cwd(), process.env.DATABASE_FILE ?? "./data/app.db"),
      catalogFile: resolve(process.cwd(), "data/catalog.json"),
      faqFile: resolve(process.cwd(), "data/faq.json")
    }),
  catch: (cause) =>
    new ConfigError({
      message: "Invalid application configuration.",
      cause
    })
});

export class AppConfigService extends Context.Tag("AppConfigService")<
  AppConfigService,
  AppConfig
>() {}

export const AppConfigLive = Layer.effect(AppConfigService, loadConfig);
