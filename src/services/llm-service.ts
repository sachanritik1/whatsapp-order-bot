import { Context, Effect, Layer } from "effect";

import { AppConfigService } from "../config.js";
import { buildHeuristicPlan } from "./llm/heuristics.js";
import { callGeminiPlan, callOpenRouterPlan, createRemotePlanEffect } from "./llm/remote.js";
import type { PlanTurnInput } from "./llm/types.js";
import type { TurnPlan } from "../schema.js";

export interface LLMServiceShape {
  readonly planTurn: (input: PlanTurnInput) => Effect.Effect<TurnPlan>;
}

export class LLMService extends Context.Tag("LLMService")<LLMService, LLMServiceShape>() {}

export type { PlanTurnInput } from "./llm/types.js";

export const LLMServiceLive = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const config = yield* AppConfigService;
    const hasOpenRouter = config.openRouterApiKey !== null && config.openRouterModel !== null;
    const hasGemini = config.googleGeminiApiKey !== null && config.googleGeminiModel !== null;
    const configuredProvider =
      config.llmProvider ??
      (hasOpenRouter ? "openrouter" : hasGemini ? "gemini" : null);

    return LLMService.of({
      planTurn: (input) => {
        if (
          configuredProvider === "openrouter" &&
          config.openRouterApiKey !== null &&
          config.openRouterModel !== null
        ) {
          const apiKey = config.openRouterApiKey;
          const model = config.openRouterModel;
          return createRemotePlanEffect("openrouter", input, () =>
            callOpenRouterPlan(apiKey, model, input)
          );
        }

        if (
          configuredProvider === "gemini" &&
          config.googleGeminiApiKey !== null &&
          config.googleGeminiModel !== null
        ) {
          const apiKey = config.googleGeminiApiKey;
          const model = config.googleGeminiModel;
          return createRemotePlanEffect("gemini", input, () =>
            callGeminiPlan(apiKey, model, input)
          );
        }

        return Effect.sync(() => buildHeuristicPlan(input));
      }
    });
  })
);
