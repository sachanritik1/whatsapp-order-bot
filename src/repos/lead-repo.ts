import { Context, Effect, Layer, Schema } from "effect";

import { DatabaseError } from "../errors.js";
import { DatabaseClient } from "./database.js";
import { LeadSchema, type Lead } from "../schema.js";

export interface CreateLeadInput {
  readonly sourceMessageId: string;
  readonly phone: string;
  readonly name: string;
  readonly product: string;
  readonly quantity: number;
  readonly cityOrPincode: string;
}

export interface LeadRepoShape {
  readonly create: (input: CreateLeadInput) => Effect.Effect<Lead, DatabaseError>;
  readonly findBySourceMessageId: (
    sourceMessageId: string
  ) => Effect.Effect<Lead | null, DatabaseError>;
  readonly list: Effect.Effect<ReadonlyArray<Lead>, DatabaseError>;
}

export class LeadRepo extends Context.Tag("LeadRepo")<LeadRepo, LeadRepoShape>() {}

const decodeLead = Schema.decodeUnknownSync(LeadSchema);
const decodeLeads = Schema.decodeUnknownSync(Schema.Array(LeadSchema));

export const LeadRepoLive = Layer.effect(
  LeadRepo,
  Effect.gen(function* () {
    const db = yield* DatabaseClient;

    const insertLead = db.prepare(`
      INSERT INTO leads (source_message_id, phone, name, product, quantity, city_or_pincode, created_at)
      VALUES (@sourceMessageId, @phone, @name, @product, @quantity, @cityOrPincode, @createdAt)
      ON CONFLICT(source_message_id) DO NOTHING
    `);
    const findBySourceMessageId = db.prepare(`
      SELECT
        id,
        source_message_id AS sourceMessageId,
        phone,
        name,
        product,
        quantity,
        city_or_pincode AS cityOrPincode,
        created_at AS createdAt
      FROM leads
      WHERE source_message_id = ?
      LIMIT 1
    `);
    const listLeads = db.prepare(`
      SELECT
        id,
        source_message_id AS sourceMessageId,
        phone,
        name,
        product,
        quantity,
        city_or_pincode AS cityOrPincode,
        created_at AS createdAt
      FROM leads
      ORDER BY id ASC
    `);

    return LeadRepo.of({
      create: (input) =>
        Effect.try({
          try: () => {
            const createdAt = new Date().toISOString();
            insertLead.run({
              ...input,
              createdAt
            });

            const row = findBySourceMessageId.get(input.sourceMessageId);
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
        Effect.try({
          try: () => {
            const row = findBySourceMessageId.get(sourceMessageId);
            return row ? decodeLead(row) : null;
          },
          catch: (cause) =>
            new DatabaseError({
              message: "Unable to find lead by source message id.",
              cause
            })
        }),
      list: Effect.try({
        try: () => decodeLeads(listLeads.all()),
        catch: (cause) =>
          new DatabaseError({
            message: "Unable to list leads.",
            cause
          })
      })
    });
  })
);
