import { Context, Effect, Layer, Schema } from "effect";

import { DatabaseError } from "../errors.js";
import { DatabaseClient } from "./database.js";
import { OrderSessionSchema, type OrderSession } from "../schema.js";

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

const decodeOrderSession = Schema.decodeUnknownSync(OrderSessionSchema);
const parseJsonArray = <A>(value: unknown): ReadonlyArray<A> => {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as ReadonlyArray<A>) : [];
  } catch {
    return [];
  }
};

export const OrderSessionRepoLive = Layer.effect(
  OrderSessionRepo,
  Effect.gen(function* () {
    const db = yield* DatabaseClient;

    const getByPhoneStatement = db.prepare(`
      SELECT
        phone,
        name,
        product,
        quantity,
        city_or_pincode AS cityOrPincode,
        selected_product_id AS selectedProductId,
        candidate_product_ids AS candidateProductIds,
        missing_fields AS missingFields,
        last_asked_follow_up AS lastAskedFollowUp,
        clarification_count AS clarificationCount,
        status,
        updated_at AS updatedAt
      FROM order_sessions
      WHERE phone = ?
    `);

    const saveStatement = db.prepare(`
      INSERT INTO order_sessions (
        phone, name, product, quantity, city_or_pincode, selected_product_id,
        candidate_product_ids, missing_fields, last_asked_follow_up, clarification_count,
        status, updated_at
      )
      VALUES (
        @phone, @name, @product, @quantity, @cityOrPincode, @selectedProductId,
        @candidateProductIds, @missingFields, @lastAskedFollowUp, @clarificationCount,
        @status, @updatedAt
      )
      ON CONFLICT(phone) DO UPDATE SET
        name = excluded.name,
        product = excluded.product,
        quantity = excluded.quantity,
        city_or_pincode = excluded.city_or_pincode,
        selected_product_id = excluded.selected_product_id,
        candidate_product_ids = excluded.candidate_product_ids,
        missing_fields = excluded.missing_fields,
        last_asked_follow_up = excluded.last_asked_follow_up,
        clarification_count = excluded.clarification_count,
        status = excluded.status,
        updated_at = excluded.updated_at
    `);

    const clearStatement = db.prepare("DELETE FROM order_sessions WHERE phone = ?");

    return OrderSessionRepo.of({
      getByPhone: (phone) =>
        Effect.try({
          try: () => {
            const row = getByPhoneStatement.get(phone) as
              | {
                  readonly phone: string;
                  readonly name: string | null;
                  readonly product: string | null;
                  readonly quantity: number | null;
                  readonly cityOrPincode: string | null;
                  readonly selectedProductId: string | null;
                  readonly candidateProductIds: string;
                  readonly missingFields: string;
                  readonly lastAskedFollowUp: string | null;
                  readonly clarificationCount: number;
                  readonly status: "open" | "completed";
                  readonly updatedAt: string;
                }
              | undefined;
            return row
              ? decodeOrderSession({
                  ...row,
                  candidateProductIds: parseJsonArray<string>(row.candidateProductIds),
                  missingFields: parseJsonArray<
                    "name" | "product" | "quantity" | "cityOrPincode"
                  >(row.missingFields)
                })
              : null;
          },
          catch: (cause) =>
            new DatabaseError({
              message: "Unable to fetch order session.",
              cause
            })
        }),
      save: (input) =>
        Effect.try({
          try: () => {
            const updatedAt = new Date().toISOString();
            saveStatement.run({
              ...input,
              candidateProductIds: JSON.stringify(input.candidateProductIds),
              missingFields: JSON.stringify(input.missingFields),
              updatedAt
            });

            return decodeOrderSession({
              ...input,
              updatedAt
            });
          },
          catch: (cause) =>
            new DatabaseError({
              message: "Unable to save order session.",
              cause
            })
        }),
      clear: (phone) =>
        Effect.try({
          try: () => {
            clearStatement.run(phone);
          },
          catch: (cause) =>
            new DatabaseError({
              message: "Unable to clear order session.",
              cause
            })
        })
    });
  })
);
