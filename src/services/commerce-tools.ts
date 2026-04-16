import { Context, Effect, Layer, Schema } from "effect";

import { overlapScore, tokenize } from "../lib/text.js";
import { CatalogRepo } from "../repos/catalog-repo.js";
import { FaqRepo } from "../repos/faq-repo.js";
import { LeadRepo } from "../repos/lead-repo.js";
import { OrderSessionRepo } from "../repos/order-session-repo.js";
import {
  FaqSearchResultSchema,
  ProductSearchResultSchema,
  type FaqSearchResult,
  type OrderSession,
  type ProductSearchHit,
  type ProductSearchResult
} from "../schema.js";

export interface UpdateSessionInput {
  readonly phone: string;
  readonly name?: string | null;
  readonly product?: string | null;
  readonly quantity?: number | null;
  readonly cityOrPincode?: string | null;
  readonly selectedProductId?: string | null;
  readonly candidateProductIds?: ReadonlyArray<string>;
  readonly missingFields?: ReadonlyArray<"name" | "product" | "quantity" | "cityOrPincode">;
  readonly lastAskedFollowUp?: string | null;
  readonly clarificationCount?: number;
  readonly status?: "open" | "completed";
}

export interface CommerceToolsShape {
  readonly listCatalog: (limit: number) => Effect.Effect<ProductSearchResult>;
  readonly searchProducts: (
    query: string,
    limit: number,
    includeAlternatives: boolean
  ) => Effect.Effect<ProductSearchResult>;
  readonly getProductDetails: (productIdOrName: string) => Effect.Effect<ProductSearchHit | null>;
  readonly searchFaq: (query: string) => Effect.Effect<FaqSearchResult>;
  readonly getSession: (phone: string) => Effect.Effect<OrderSession | null, unknown>;
  readonly updateSession: (input: UpdateSessionInput) => Effect.Effect<OrderSession, unknown>;
  readonly createLeadFromSession: (input: {
    readonly phone: string;
    readonly sourceMessageId: string;
  }) => Effect.Effect<{
    readonly leadId: number;
    readonly sourceMessageId: string;
    readonly name: string;
    readonly product: string;
    readonly quantity: number;
    readonly cityOrPincode: string;
  }, unknown>;
}

export class CommerceTools extends Context.Tag("CommerceTools")<
  CommerceTools,
  CommerceToolsShape
>() {}

const decodeProductSearchResult = Schema.decodeUnknownSync(ProductSearchResultSchema);
const decodeFaqSearchResult = Schema.decodeUnknownSync(FaqSearchResultSchema);

const missingFieldsFor = (session: {
  readonly name: string | null;
  readonly product: string | null;
  readonly quantity: number | null;
  readonly cityOrPincode: string | null;
}): ReadonlyArray<"name" | "product" | "quantity" | "cityOrPincode"> => {
  const missing: Array<"name" | "product" | "quantity" | "cityOrPincode"> = [];
  if (!session.name) missing.push("name");
  if (!session.product) missing.push("product");
  if (!session.quantity) missing.push("quantity");
  if (!session.cityOrPincode) missing.push("cityOrPincode");
  return missing;
};

export const CommerceToolsLive = Layer.effect(
  CommerceTools,
  Effect.gen(function* () {
    const catalogRepo = yield* CatalogRepo;
    const faqRepo = yield* FaqRepo;
    const leadRepo = yield* LeadRepo;
    const orderSessionRepo = yield* OrderSessionRepo;

    const scoreProducts = (
      query: string,
      limit: number,
      includeAlternatives: boolean,
      products: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly description: string;
        readonly price: number;
        readonly currency: string;
        readonly tags: ReadonlyArray<string>;
      }>
    ): ProductSearchResult => {
      const queryTokens = tokenize(query);
      const scored: ReadonlyArray<ProductSearchHit> = products
        .map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          price: item.price,
          currency: item.currency,
          score: overlapScore(queryTokens, tokenize([item.name, item.description, ...item.tags].join(" ")))
        }))
        .sort((left, right) => right.score - left.score || left.price - right.price);

      const matches = scored.filter((item) => item.score > 0).slice(0, limit);
      const alternatives = includeAlternatives
        ? scored
            .filter((item) => !matches.some((match) => match.id === item.id))
            .slice(0, limit)
        : [];

      return decodeProductSearchResult({
        query,
        matches,
        alternatives
      });
    };

    return CommerceTools.of({
      listCatalog: (limit) =>
        catalogRepo.getAll.pipe(
          Effect.map((products) =>
            decodeProductSearchResult({
              query: "catalog",
              matches: products.slice(0, limit).map((item) => ({
                id: item.id,
                name: item.name,
                description: item.description,
                price: item.price,
                currency: item.currency,
                score: 1
              })),
              alternatives: products.slice(limit).map((item) => ({
                id: item.id,
                name: item.name,
                description: item.description,
                price: item.price,
                currency: item.currency,
                score: 0.5
              }))
            })
          )
        ),
      searchProducts: (query, limit, includeAlternatives) =>
        catalogRepo.getAll.pipe(
          Effect.map((products) => scoreProducts(query, limit, includeAlternatives, products))
        ),
      getProductDetails: (productIdOrName) =>
        catalogRepo.getAll.pipe(
          Effect.map((products) => {
            const normalized = productIdOrName.toLowerCase();
            const product =
              products.find((item) => item.id.toLowerCase() === normalized) ??
              products.find((item) => item.name.toLowerCase() === normalized) ??
              products.find((item) => item.name.toLowerCase().includes(normalized));

            return product
              ? ({
                  id: product.id,
                  name: product.name,
                  description: product.description,
                  price: product.price,
                  currency: product.currency,
                  score: 1
                } satisfies ProductSearchHit)
              : null;
          })
        ),
      searchFaq: (query) =>
        faqRepo.getAll.pipe(
          Effect.map((entries) => {
            const queryTokens = tokenize(query);
            const scored = entries
              .map((entry) => ({
                entry,
                score: overlapScore(
                  queryTokens,
                  tokenize([entry.question, entry.answer, ...entry.tags].join(" "))
                )
              }))
              .sort((left, right) => right.score - left.score);

            return decodeFaqSearchResult({
              query,
              match: scored.at(0)?.score && scored.at(0)!.score > 0 ? scored.at(0)!.entry : null,
              score: scored.at(0)?.score ?? 0
            });
          })
        ),
      getSession: (phone) => orderSessionRepo.getByPhone(phone),
      updateSession: (input) =>
        orderSessionRepo.getByPhone(input.phone).pipe(
          Effect.flatMap((current) =>
            orderSessionRepo.save({
              phone: input.phone,
              name: input.name ?? current?.name ?? null,
              product: input.product ?? current?.product ?? null,
              quantity: input.quantity ?? current?.quantity ?? null,
              cityOrPincode: input.cityOrPincode ?? current?.cityOrPincode ?? null,
              selectedProductId: input.selectedProductId ?? current?.selectedProductId ?? null,
              candidateProductIds:
                input.candidateProductIds ?? current?.candidateProductIds ?? [],
              missingFields:
                input.missingFields ??
                missingFieldsFor({
                  name: input.name ?? current?.name ?? null,
                  product: input.product ?? current?.product ?? null,
                  quantity: input.quantity ?? current?.quantity ?? null,
                  cityOrPincode: input.cityOrPincode ?? current?.cityOrPincode ?? null
                }),
              lastAskedFollowUp:
                input.lastAskedFollowUp !== undefined
                  ? input.lastAskedFollowUp
                  : current?.lastAskedFollowUp ?? null,
              clarificationCount:
                input.clarificationCount ?? current?.clarificationCount ?? 0,
              status: input.status ?? current?.status ?? "open"
            })
          )
        ),
      createLeadFromSession: ({ phone, sourceMessageId }) =>
        Effect.gen(function* () {
          const session = yield* orderSessionRepo.getByPhone(phone);
          const existingLead = yield* leadRepo.findBySourceMessageId(sourceMessageId);

          if (existingLead) {
            return {
              leadId: existingLead.id,
              sourceMessageId: existingLead.sourceMessageId,
              name: existingLead.name,
              product: existingLead.product,
              quantity: existingLead.quantity,
              cityOrPincode: existingLead.cityOrPincode
            };
          }

          if (
            !session?.name ||
            !session.product ||
            !session.quantity ||
            !session.cityOrPincode
          ) {
            return yield* Effect.fail(
              new Error("Cannot create lead from incomplete order session.")
            );
          }

          const lead = yield* leadRepo.create({
            sourceMessageId,
            phone,
            name: session.name,
            product: session.product,
            quantity: session.quantity,
            cityOrPincode: session.cityOrPincode
          });

          return {
            leadId: lead.id,
            sourceMessageId: lead.sourceMessageId,
            name: lead.name,
            product: lead.product,
            quantity: lead.quantity,
            cityOrPincode: lead.cityOrPincode
          };
        })
    });
  })
);
