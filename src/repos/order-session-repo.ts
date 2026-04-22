import { Context, Effect } from "effect";

import { DatabaseError } from "../errors.js";
import { type OrderSession } from "../schema.js";

export interface SaveOrderSessionInput {
  readonly phone: string;
  readonly name: string | null;
  readonly product: string | null;
  readonly quantity: number | null;
  readonly cityOrPincode: string | null;
  readonly selectedProductId: string | null;
  readonly candidateProductIds: ReadonlyArray<string>;
  readonly missingFields: ReadonlyArray<"name" | "product" | "quantity" | "cityOrPincode">;
  readonly lastAskedFollowUp: string | null;
  readonly clarificationCount: number;
  readonly status: "open" | "completed";
}

export interface OrderSessionRepoShape {
  readonly getByPhone: (phone: string) => Effect.Effect<OrderSession | null, DatabaseError>;
  readonly save: (
    input: SaveOrderSessionInput
  ) => Effect.Effect<OrderSession, DatabaseError>;
  readonly clear: (phone: string) => Effect.Effect<void, DatabaseError>;
}

export class OrderSessionRepo extends Context.Tag("OrderSessionRepo")<
  OrderSessionRepo,
  OrderSessionRepoShape
>() {}
