import { Context, Effect, Layer } from "effect";

import { TurnPlanner, type PlanTurnInput } from "./turn-planner.js";
import type { TurnPlan } from "../schema.js";

export interface LLMServiceShape {
  readonly planTurn: (input: PlanTurnInput) => Effect.Effect<TurnPlan>;
}

export class LLMService extends Context.Tag("LLMService")<LLMService, LLMServiceShape>() {}

export type { PlanTurnInput } from "./turn-planner.js";

export const LLMServiceLive = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const turnPlanner = yield* TurnPlanner;

    return LLMService.of({
      planTurn: (input) => turnPlanner.planTurn(input)
    });
  })
);
