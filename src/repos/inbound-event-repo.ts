import { Context, Effect } from "effect";

import { DatabaseError } from "../errors.js";
import {
  type InboundEvent,
  type InboundMessage
} from "../schema.js";

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
