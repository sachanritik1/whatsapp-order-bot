import { Context, Effect, Layer, Schema } from "effect";
import { readFile } from "node:fs/promises";

import { AppConfigService } from "../config.js";
import { DataLoadError } from "../errors.js";
import { overlapScore, tokenize } from "../lib/text.js";
import { FaqEntrySchema, type FaqEntry } from "../schema.js";

const decodeFaq = Schema.decodeUnknownSync(Schema.Array(FaqEntrySchema));

export interface FaqRepoShape {
  readonly getAll: Effect.Effect<ReadonlyArray<FaqEntry>>;
  readonly findBestMatch: (query: string) => Effect.Effect<FaqEntry | null>;
}

export class FaqRepo extends Context.Tag("FaqRepo")<FaqRepo, FaqRepoShape>() {}

const buildSearchText = (entry: FaqEntry): string =>
  [entry.question, entry.answer, ...entry.tags].join(" ");

export const FaqRepoLive = Layer.effect(
  FaqRepo,
  Effect.gen(function* () {
    const config = yield* AppConfigService;

    const rawFaq = yield* Effect.tryPromise({
      try: () => readFile(config.faqFile, "utf8"),
      catch: (cause) =>
        new DataLoadError({
          message: `Unable to read FAQ file at ${config.faqFile}.`,
          cause
        })
    });

    const faqEntries = yield* Effect.try({
      try: () => decodeFaq(JSON.parse(rawFaq)),
      catch: (cause) =>
        new DataLoadError({
          message: "FAQ JSON is invalid.",
          cause
        })
    });

    const searchIndex = faqEntries.map((entry) => ({
      entry,
      tokens: tokenize(buildSearchText(entry))
    }));

    return FaqRepo.of({
      getAll: Effect.succeed(faqEntries),
      findBestMatch: (query) =>
        Effect.succeed(
          searchIndex
            .map(({ entry, tokens }) => ({
              entry,
              score: overlapScore(tokenize(query), tokens)
            }))
            .sort((left, right) => right.score - left.score)
            .find((entry) => entry.score > 0)?.entry ?? null
        )
    });
  })
);
