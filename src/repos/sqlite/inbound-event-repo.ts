import { and, asc, eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";

import { DatabaseError } from "../../errors.js";
import {
  InboundEventSchema,
  InboundMessageSchema,
  type InboundEvent,
  type InboundMessage
} from "../../schema.js";
import { InboundEventRepo } from "../inbound-event-repo.js";
import { SqliteDatabaseClient } from "./database.js";
import { inboundEventsTable } from "./db-schema.js";

const decodeInboundEvent = Schema.decodeUnknownSync(InboundEventSchema);
const decodeInboundEvents = Schema.decodeUnknownSync(Schema.Array(InboundEventSchema));
const decodeInboundMessage = Schema.decodeUnknownSync(InboundMessageSchema);

export const SqliteInboundEventRepoLive = Layer.effect(
  InboundEventRepo,
  Effect.gen(function* () {
    const db = yield* SqliteDatabaseClient;

    const claimNext = () =>
      db.drizzle.transaction((tx) => {
        const row = tx
          .select({
            id: inboundEventsTable.id,
            phone: inboundEventsTable.phone,
            text: inboundEventsTable.text,
            messageId: inboundEventsTable.messageId,
            status: inboundEventsTable.status,
            attempts: inboundEventsTable.attempts,
            errorMessage: inboundEventsTable.errorMessage,
            receivedAt: inboundEventsTable.receivedAt,
            updatedAt: inboundEventsTable.updatedAt
          })
          .from(inboundEventsTable)
          .where(eq(inboundEventsTable.status, "pending"))
          .orderBy(asc(inboundEventsTable.id))
          .limit(1)
          .get() as
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
        const update = tx
          .update(inboundEventsTable)
          .set({
            status: "processing",
            attempts: row.attempts + 1,
            errorMessage: null,
            updatedAt: now
          })
          .where(and(eq(inboundEventsTable.id, row.id), eq(inboundEventsTable.status, "pending")))
          .run();
        if (update.changes === 0) {
          return null;
        }

        return decodeInboundEvent({
          ...row,
          status: "processing",
          attempts: row.attempts + 1,
          errorMessage: null,
          updatedAt: now
        });
      });

    return InboundEventRepo.of({
      enqueue: (messages: ReadonlyArray<InboundMessage>) =>
        Effect.try({
          try: () => {
            const now = new Date().toISOString();
            db.drizzle.transaction((tx) => {
              for (const message of messages) {
                const decoded = decodeInboundMessage(message);
                tx
                  .insert(inboundEventsTable)
                  .values({
                    phone: decoded.phone,
                    text: decoded.text,
                    messageId: decoded.messageId,
                    status: "pending",
                    attempts: 0,
                    errorMessage: null,
                    receivedAt: decoded.receivedAt,
                    createdAt: now,
                    updatedAt: now
                  })
                  .onConflictDoNothing({
                    target: inboundEventsTable.messageId
                  })
                  .run();
              }
            });
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
            db.drizzle
              .update(inboundEventsTable)
              .set({
                status: "processed",
                updatedAt: new Date().toISOString()
              })
              .where(eq(inboundEventsTable.id, id))
              .run();
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
            db.drizzle
              .update(inboundEventsTable)
              .set({
                status: "failed",
                errorMessage,
                updatedAt: new Date().toISOString()
              })
              .where(eq(inboundEventsTable.id, id))
              .run();

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
            const row = db.drizzle
              .select({
                attempts: inboundEventsTable.attempts
              })
              .from(inboundEventsTable)
              .where(eq(inboundEventsTable.id, id))
              .limit(1)
              .get();
            const status = row && row.attempts < 3 ? "pending" : "failed";

            db.drizzle
              .update(inboundEventsTable)
              .set({
                status,
                errorMessage,
                updatedAt: new Date().toISOString()
              })
              .where(eq(inboundEventsTable.id, id))
              .run();

            return status;
          },
          catch: (cause) =>
            new DatabaseError({
              message: "Unable to mark inbound event failure.",
              cause
            })
        }),
      list: Effect.try({
        try: () =>
          decodeInboundEvents(
            db.drizzle
              .select({
                id: inboundEventsTable.id,
                phone: inboundEventsTable.phone,
                text: inboundEventsTable.text,
                messageId: inboundEventsTable.messageId,
                status: inboundEventsTable.status,
                attempts: inboundEventsTable.attempts,
                errorMessage: inboundEventsTable.errorMessage,
                receivedAt: inboundEventsTable.receivedAt,
                updatedAt: inboundEventsTable.updatedAt
              })
              .from(inboundEventsTable)
              .orderBy(asc(inboundEventsTable.id))
              .all()
          ),
        catch: (cause) =>
          new DatabaseError({
            message: "Unable to list inbound events.",
            cause
          })
      })
    });
  })
);
