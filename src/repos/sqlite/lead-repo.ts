import { asc, eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";

import { DatabaseError } from "../../errors.js";
import { LeadSchema, type Lead } from "../../schema.js";
import { LeadRepo, type CreateLeadInput } from "../lead-repo.js";
import { SqliteDatabaseClient } from "./database.js";
import { leadsTable } from "./db-schema.js";

const decodeLead = Schema.decodeUnknownSync(LeadSchema);
const decodeLeads = Schema.decodeUnknownSync(Schema.Array(LeadSchema));

export const SqliteLeadRepoLive = Layer.effect(
  LeadRepo,
  Effect.gen(function* () {
    const db = yield* SqliteDatabaseClient;

    return LeadRepo.of({
      create: (input: CreateLeadInput) =>
        Effect.tryPromise({
          try: async () => {
            const createdAt = new Date().toISOString();
            await db.drizzle
              .insert(leadsTable)
              .values({
                sourceMessageId: input.sourceMessageId,
                phone: input.phone,
                name: input.name,
                product: input.product,
                quantity: input.quantity,
                cityOrPincode: input.cityOrPincode,
                createdAt
              })
              .onConflictDoNothing()
              .run();

            const row = await db.drizzle.query.leads.findFirst({
              where: eq(leadsTable.sourceMessageId, input.sourceMessageId)
            });
            if (!row) {
              throw new Error("Lead insert did not return a stored row.");
            }

            return decodeLead(row);
          },
          catch: (cause) =>
            new DatabaseError({
              message: "Unable to create lead.",
              cause
            })
        }),
      findBySourceMessageId: (sourceMessageId) =>
        Effect.tryPromise({
          try: async () => {
            const row = await db.drizzle.query.leads.findFirst({
              where: eq(leadsTable.sourceMessageId, sourceMessageId)
            });
            return row ? decodeLead(row) : null;
          },
          catch: (cause) =>
            new DatabaseError({
              message: "Unable to find lead by source message id.",
              cause
            })
        }),
      list: Effect.tryPromise({
        try: async () => {
          const rows = await db.drizzle.query.leads.findMany({
            orderBy: (leads, { asc: orderAsc }) => [orderAsc(leads.id)]
          });
          return decodeLeads(rows);
        },
        catch: (cause) =>
          new DatabaseError({
            message: "Unable to list leads.",
            cause
          })
      })
    });
  })
);
