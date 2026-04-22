import { eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";

import { DatabaseError } from "../../errors.js";
import { OrderSessionSchema, type OrderSession } from "../../schema.js";
import {
  OrderSessionRepo,
  type SaveOrderSessionInput
} from "../order-session-repo.js";
import { SqliteDatabaseClient } from "./database.js";
import { orderSessionsTable } from "./db-schema.js";

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

export const SqliteOrderSessionRepoLive = Layer.effect(
  OrderSessionRepo,
  Effect.gen(function* () {
    const db = yield* SqliteDatabaseClient;

    return OrderSessionRepo.of({
      getByPhone: (phone) =>
        Effect.try({
          try: () => {
            const row = db.drizzle
              .select({
                phone: orderSessionsTable.phone,
                name: orderSessionsTable.name,
                product: orderSessionsTable.product,
                quantity: orderSessionsTable.quantity,
                cityOrPincode: orderSessionsTable.cityOrPincode,
                selectedProductId: orderSessionsTable.selectedProductId,
                candidateProductIds: orderSessionsTable.candidateProductIds,
                missingFields: orderSessionsTable.missingFields,
                lastAskedFollowUp: orderSessionsTable.lastAskedFollowUp,
                clarificationCount: orderSessionsTable.clarificationCount,
                status: orderSessionsTable.status,
                updatedAt: orderSessionsTable.updatedAt
              })
              .from(orderSessionsTable)
              .where(eq(orderSessionsTable.phone, phone))
              .limit(1)
              .get() as
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
      save: (input: SaveOrderSessionInput) =>
        Effect.try({
          try: () => {
            const updatedAt = new Date().toISOString();
            db.drizzle
              .insert(orderSessionsTable)
              .values({
                phone: input.phone,
                name: input.name,
                product: input.product,
                quantity: input.quantity,
                cityOrPincode: input.cityOrPincode,
                selectedProductId: input.selectedProductId,
                candidateProductIds: JSON.stringify(input.candidateProductIds),
                missingFields: JSON.stringify(input.missingFields),
                lastAskedFollowUp: input.lastAskedFollowUp,
                clarificationCount: input.clarificationCount,
                status: input.status,
                updatedAt
              })
              .onConflictDoUpdate({
                target: orderSessionsTable.phone,
                set: {
                  name: input.name,
                  product: input.product,
                  quantity: input.quantity,
                  cityOrPincode: input.cityOrPincode,
                  selectedProductId: input.selectedProductId,
                  candidateProductIds: JSON.stringify(input.candidateProductIds),
                  missingFields: JSON.stringify(input.missingFields),
                  lastAskedFollowUp: input.lastAskedFollowUp,
                  clarificationCount: input.clarificationCount,
                  status: input.status,
                  updatedAt
                }
              })
              .run();

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
            db.drizzle.delete(orderSessionsTable).where(eq(orderSessionsTable.phone, phone)).run();
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
