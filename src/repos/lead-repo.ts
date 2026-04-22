import { Context, Effect } from "effect";

import { DatabaseError } from "../errors.js";
import { type Lead } from "../schema.js";

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
