import { Context, Effect, Layer, Schema } from "effect";

import { DatabaseError } from "../errors.js";
import {
  InboundEventSchema,
  InboundMessageSchema,
  type InboundEvent,
  type InboundMessage
} from "../schema.js";
import { DatabaseClient } from "./database.js";

export interface InboundEventRepoShape {
  readonly enqueue: (
    messages: ReadonlyArray<InboundMessage>
  ) => Effect.Effect<void, DatabaseError>;
  readonly claimNext: Effect.Effect<InboundEvent | null, DatabaseError>;
  readonly markProcessed: (id: number) => Effect.Effect<void, DatabaseError>;
  readonly markFailed: (id: number, errorMessage: string) => Effect.Effect<"failed", DatabaseError>;
  readonly markRetryableFailure: (
    id: number,
    errorMessage: string
  ) => Effect.Effect<"pending" | "failed", DatabaseError>;
  readonly list: Effect.Effect<ReadonlyArray<InboundEvent>, DatabaseError>;
}

export class InboundEventRepo extends Context.Tag("InboundEventRepo")<
  InboundEventRepo,
  InboundEventRepoShape
>() {}

const decodeInboundEvent = Schema.decodeUnknownSync(InboundEventSchema);
const decodeInboundEvents = Schema.decodeUnknownSync(Schema.Array(InboundEventSchema));
const decodeInboundMessage = Schema.decodeUnknownSync(InboundMessageSchema);

export const InboundEventRepoLive = Layer.effect(
  InboundEventRepo,
  Effect.gen(function* () {
    const db = yield* DatabaseClient;

    const insertStatement = db.prepare(`
      INSERT INTO inbound_events (phone, text, message_id, status, attempts, error_message, received_at, created_at, updated_at)
      VALUES (@phone, @text, @messageId, 'pending', 0, NULL, @receivedAt, @createdAt, @updatedAt)
      ON CONFLICT(message_id) DO NOTHING
    `);

    const claimSelect = db.prepare(`
      SELECT
        id,
        phone,
        text,
        message_id AS messageId,
        status,
        attempts,
        error_message AS errorMessage,
        received_at AS receivedAt,
        updated_at AS updatedAt
      FROM inbound_events
      WHERE status = 'pending'
      ORDER BY id ASC
      LIMIT 1
    `);

    const claimUpdate = db.prepare(`
      UPDATE inbound_events
      SET status = 'processing', attempts = attempts + 1, updated_at = @updatedAt, error_message = NULL
      WHERE id = @id AND status = 'pending'
    `);

    const processedStatement = db.prepare(`
      UPDATE inbound_events
      SET status = 'processed', updated_at = @updatedAt
      WHERE id = @id
    `);

    const failureStatement = db.prepare(`
      UPDATE inbound_events
      SET status = @status, updated_at = @updatedAt, error_message = @errorMessage
      WHERE id = @id
    `);

    const listStatement = db.prepare(`
      SELECT
        id,
        phone,
        text,
        message_id AS messageId,
        status,
        attempts,
        error_message AS errorMessage,
        received_at AS receivedAt,
        updated_at AS updatedAt
      FROM inbound_events
      ORDER BY id ASC
    `);

    const claimNext = db.transaction(() => {
      const row = claimSelect.get() as
        | {
            readonly id: number;
            readonly phone: string;
            readonly text: string;
            readonly messageId: string;
            readonly status: "pending";
            readonly attempts: number;
            readonly errorMessage: string | null;
            readonly receivedAt: string;
            readonly updatedAt: string;
          }
        | undefined;

      if (!row) {
        return null;
      }

      const now = new Date().toISOString();
      const update = claimUpdate.run({
        id: row.id,
        updatedAt: now
      });
      if (update.changes === 0) {
        return null;
      }

      return decodeInboundEvent({
        ...row,
        status: "processing",
        attempts: Number(row.attempts) + 1,
        errorMessage: null,
        updatedAt: now
      });
    });

    return InboundEventRepo.of({
      enqueue: (messages) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString();
            const transaction = db.transaction((items: ReadonlyArray<InboundMessage>) => {
              for (const message of items) {
                const decoded = decodeInboundMessage(message);
                insertStatement.run({
                  ...decoded,
                  createdAt: now,
                  updatedAt: now
                });
              }
            });

            transaction(messages);
          },
          catch: (cause) =>
            new DatabaseError({
              message: "Unable to enqueue inbound events.",
              cause
            })
        }),
      claimNext: Effect.try({
        try: claimNext,
        catch: (cause) =>
          new DatabaseError({
            message: "Unable to claim inbound event.",
            cause
          })
      }),
      markProcessed: (id) =>
        Effect.try({
          try: () => {
            processedStatement.run({
              id,
              updatedAt: new Date().toISOString()
            });
          },
          catch: (cause) =>
            new DatabaseError({
              message: "Unable to mark inbound event as processed.",
              cause
            })
        }),
        markFailed: (id, errorMessage) =>
          Effect.try({
            try: () => {
              failureStatement.run({
                id,
                status: "failed",
                errorMessage,
                updatedAt: new Date().toISOString()
              });

              return "failed" as const;
            },
            catch: (cause) =>
              new DatabaseError({
                message: "Unable to mark inbound event as failed.",
                cause
              })
          }),
      markRetryableFailure: (id, errorMessage) =>
        Effect.try({
          try: () => {
            const row = db
              .prepare("SELECT attempts FROM inbound_events WHERE id = ?")
              .get(id) as { attempts: number } | undefined;
            const status = row && row.attempts < 3 ? "pending" : "failed";

            failureStatement.run({
              id,
              status,
              errorMessage,
              updatedAt: new Date().toISOString()
            });

            return status;
          },
          catch: (cause) =>
            new DatabaseError({
              message: "Unable to mark inbound event failure.",
              cause
            })
        }),
      list: Effect.try({
        try: () => decodeInboundEvents(listStatement.all()),
        catch: (cause) =>
          new DatabaseError({
            message: "Unable to list inbound events.",
            cause
          })
      })
    });
  })
);
