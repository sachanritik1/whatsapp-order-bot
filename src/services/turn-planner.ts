import { Context, Effect, Layer } from "effect";

import { AppConfigService } from "../config.js";
import type { TurnPlan } from "../schema.js";
import { buildHeuristicPlan } from "./llm/heuristics.js";
import { callGeminiPlan, callOpenRouterPlan, createRemotePlanEffect } from "./llm/remote.js";
import type { PlanTurnInput } from "./llm/types.js";

export interface TurnPlannerShape {
  readonly planTurn: (input: PlanTurnInput) => Effect.Effect<TurnPlan>;
}

export class TurnPlanner extends Context.Tag("TurnPlanner")<TurnPlanner, TurnPlannerShape>() {}

interface TurnPlannerDependencies {
  readonly heuristicPlan: (input: PlanTurnInput) => TurnPlan;
  readonly openRouterPlan?: ((input: PlanTurnInput) => Promise<TurnPlan>) | undefined;
  readonly geminiPlan?: ((input: PlanTurnInput) => Promise<TurnPlan>) | undefined;
}

export const makeTurnPlanner = (
  deps: TurnPlannerDependencies
): TurnPlannerShape => ({
  planTurn: (input) => {
    if (deps.openRouterPlan) {
      return createRemotePlanEffect("openrouter", input, () => deps.openRouterPlan!(input));
    }

    if (deps.geminiPlan) {
      return createRemotePlanEffect("gemini", input, () => deps.geminiPlan!(input));
    }

    return Effect.sync(() => deps.heuristicPlan(input));
  }
});

export type { PlanTurnInput } from "./llm/types.js";

export const TurnPlannerLive = Layer.effect(
  TurnPlanner,
  Effect.gen(function* () {
    const config = yield* AppConfigService;
    const hasOpenRouter = config.openRouterApiKey !== null && config.openRouterModel !== null;
    const hasGemini = config.googleGeminiApiKey !== null && config.googleGeminiModel !== null;
    const configuredProvider =
      config.llmProvider ??
      (hasOpenRouter ? "openrouter" : hasGemini ? "gemini" : null);

    return TurnPlanner.of(
      makeTurnPlanner({
        heuristicPlan: buildHeuristicPlan,
        openRouterPlan:
          configuredProvider === "openrouter" &&
          config.openRouterApiKey !== null &&
          config.openRouterModel !== null
            ? (input) =>
                callOpenRouterPlan(config.openRouterApiKey!, config.openRouterModel!, input)
            : undefined,
        geminiPlan:
          configuredProvider === "gemini" &&
          config.googleGeminiApiKey !== null &&
          config.googleGeminiModel !== null
            ? (input) =>
                callGeminiPlan(config.googleGeminiApiKey!, config.googleGeminiModel!, input)
            : undefined
      })
    );
  })
);
