import { Effect, Schema } from "effect";

import { IntegrationError } from "../../errors.js";
import { logWarn, serializeForLog } from "../../logging.js";
import { type LlmProvider, type TurnPlan } from "../../schema.js";
import { REMOTE_PROVIDER_PROMPT } from "./constants.js";
import { buildHeuristicPlan } from "./heuristics.js";
import {
  buildProviderResponseSchema,
  parseStructuredProviderResponse,
  parseTextJsonProviderResponse
} from "./provider-adapters.js";
import type { PlanTurnInput } from "./types.js";

const decodeJsonUnknown = Schema.decodeUnknownSync(Schema.Unknown);
const GEMINI_TURN_PLAN_RESPONSE_SCHEMA = buildProviderResponseSchema("gemini");

const providerLabel = (provider: LlmProvider): string =>
  provider === "gemini" ? "Gemini" : "OpenRouter";

const callOpenRouterPlan = async (
  apiKey: string,
  model: string,
  input: PlanTurnInput
): Promise<TurnPlan> => {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "x-title": "whatsapp-order-bot-poc"
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: REMOTE_PROVIDER_PROMPT
        },
        {
          role: "user",
          content: JSON.stringify(input)
        }
      ]
    })
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new IntegrationError({
      service: "openrouter",
      message: `OpenRouter API ${response.status} ${response.statusText}`,
      cause: {
        status: response.status,
        statusText: response.statusText,
        body: responseBody
      }
    });
  }

  const payload = decodeJsonUnknown(await response.json()) as {
    choices?: ReadonlyArray<{
      message?: {
        content?: string | null;
      };
    }>;
  };

  const content = payload.choices?.at(0)?.message?.content;
  if (!content) {
    throw new IntegrationError({
      service: "openrouter",
      message: "OpenRouter returned an empty response.",
      cause: payload
    });
  }

  return parseTextJsonProviderResponse("openrouter", content, input);
};

const callGeminiPlan = async (
  apiKey: string,
  model: string,
  input: PlanTurnInput
): Promise<TurnPlan> => {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: REMOTE_PROVIDER_PROMPT }]
        },
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: GEMINI_TURN_PLAN_RESPONSE_SCHEMA
        },
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify(input) }]
          }
        ]
      })
    }
  );

  if (!response.ok) {
    const responseBody = await response.text();
    throw new IntegrationError({
      service: "gemini",
      message: `Gemini API ${response.status} ${response.statusText}`,
      cause: {
        status: response.status,
        statusText: response.statusText,
        body: responseBody
      }
    });
  }

  const payload = decodeJsonUnknown(await response.json()) as {
    candidates?: ReadonlyArray<{
      content?: {
        parts?: ReadonlyArray<{
          text?: string | null;
        }>;
      };
    }>;
  };

  const content = payload.candidates
    ?.at(0)
    ?.content?.parts?.map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!content) {
    throw new IntegrationError({
      service: "gemini",
      message: "Gemini returned an empty response.",
      cause: payload
    });
  }

  return parseStructuredProviderResponse("gemini", content, input);
};

const createRemotePlanEffect = (
  provider: LlmProvider,
  input: PlanTurnInput,
  plan: () => Promise<TurnPlan>
) =>
  Effect.tryPromise({
    try: plan,
    catch: (cause) =>
      cause instanceof IntegrationError
        ? cause
        : new IntegrationError({
            service: provider,
            message: `${providerLabel(provider)} turn planning request failed.`,
            cause: serializeForLog(cause)
          })
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        logWarn(`${provider}.fallback`, {
          reason: `${providerLabel(provider)} turn planning failed; using heuristic planner.`,
          error: serializeForLog(error)
        });
        return buildHeuristicPlan(input);
      })
    )
  );

export { callGeminiPlan, callOpenRouterPlan, createRemotePlanEffect };
