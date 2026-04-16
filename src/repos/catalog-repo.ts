import { Context, Effect, Layer, Schema } from "effect";
import { readFile } from "node:fs/promises";

import { AppConfigService } from "../config.js";
import { DataLoadError } from "../errors.js";
import { overlapScore, tokenize } from "../lib/text.js";
import { CatalogItemSchema, type CatalogItem } from "../schema.js";

const decodeCatalog = Schema.decodeUnknownSync(Schema.Array(CatalogItemSchema));

export interface CatalogRepoShape {
  readonly getAll: Effect.Effect<ReadonlyArray<CatalogItem>>;
  readonly findBestMatches: (
    query: string,
    limit: number
  ) => Effect.Effect<ReadonlyArray<CatalogItem>>;
  readonly findByName: (query: string) => Effect.Effect<CatalogItem | null>;
}

export class CatalogRepo extends Context.Tag("CatalogRepo")<
  CatalogRepo,
  CatalogRepoShape
>() {}

const buildSearchText = (item: CatalogItem): string =>
  [item.name, item.description, ...item.tags].join(" ");

export const CatalogRepoLive = Layer.effect(
  CatalogRepo,
  Effect.gen(function* () {
    const config = yield* AppConfigService;

    const rawCatalog = yield* Effect.tryPromise({
      try: () => readFile(config.catalogFile, "utf8"),
      catch: (cause) =>
        new DataLoadError({
          message: `Unable to read catalog file at ${config.catalogFile}.`,
          cause
        })
    });

    const catalog = yield* Effect.try({
      try: () => decodeCatalog(JSON.parse(rawCatalog)),
      catch: (cause) =>
        new DataLoadError({
          message: "Catalog JSON is invalid.",
          cause
        })
    });

    const searchIndex = catalog.map((item) => ({
      item,
      tokens: tokenize(buildSearchText(item))
    }));

    const findMatches = (query: string, limit: number): ReadonlyArray<CatalogItem> => {
      const queryTokens = tokenize(query);

      return searchIndex
        .map(({ item, tokens }) => ({
          item,
          score: overlapScore(queryTokens, tokens)
        }))
        .sort((left, right) => right.score - left.score || left.item.price - right.item.price)
        .filter((entry) => entry.score > 0)
        .slice(0, limit)
        .map((entry) => entry.item);
    };

    return CatalogRepo.of({
      getAll: Effect.succeed(catalog),
      findBestMatches: (query, limit) => Effect.succeed(findMatches(query, limit)),
      findByName: (query) =>
        Effect.succeed(
          findMatches(query, 1).at(0) ??
            catalog.find((item) =>
              buildSearchText(item).toLowerCase().includes(query.toLowerCase())
            ) ??
            null
        )
    });
  })
);
