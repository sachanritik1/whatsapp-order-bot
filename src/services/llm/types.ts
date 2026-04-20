import type {
  FaqSearchResult,
  OrderSession,
  ProductSearchResult,
  TurnPlan
} from "../../schema.js";

export interface PlanTurnInput {
  readonly userMessage: string;
  readonly session: OrderSession | null;
  readonly productSearch?: ProductSearchResult | null;
  readonly faqSearch?: FaqSearchResult | null;
}

export type RemoteTurnPlanProvider = Exclude<TurnPlan["provider"], "heuristic">;
