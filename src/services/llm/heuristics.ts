import { Schema } from "effect";

import { containsAny, normalizeText } from "../../lib/text.js";
import {
  TurnPlanSchema,
  type Intent,
  type OrderSession,
  type ProductSearchResult,
  type TurnPlan
} from "../../schema.js";
import type { PlanTurnInput } from "./types.js";

const decodeTurnPlan = Schema.decodeUnknownSync(TurnPlanSchema);

const extractName = (text: string): string | null => {
  const match = text.match(/\b(?:my name is|i am|this is)\s+([a-z][a-z\s]{1,40})/i);
  return match?.[1]
    ? match[1]
        .trim()
        .replace(/\s+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : null;
};

const extractQuantity = (text: string): number | null => {
  const pincode = text.match(/\b\d{6}\b/)?.[0];
  const candidate = Array.from(text.matchAll(/\b(\d{1,3})\b/g))
    .map((match) => Number(match[1]))
    .find((value) => String(value) !== pincode && value > 0 && value < 100);
  return candidate ?? null;
};

const extractCityOrPincode = (text: string, session: OrderSession | null): string | null => {
  const pincode = text.match(/\b\d{6}\b/)?.[0];
  if (pincode) {
    return pincode;
  }

  if (session?.missingFields.includes("cityOrPincode") && /^[a-z\s]{2,40}$/i.test(text.trim())) {
    return text
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  const match = text.match(/\b(?:city|in|to|for)\s+([a-z\s]{2,40})$/i);
  return match?.[1]
    ? match[1]
        .trim()
        .replace(/\s+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : null;
};

const isGreeting = (message: string): boolean =>
  containsAny(normalizeText(message), [
    "hi",
    "hello",
    "hey",
    "good morning",
    "good afternoon",
    "good evening"
  ]);

const isCatalogBrowse = (message: string): boolean =>
  containsAny(normalizeText(message), [
    "what are your products",
    "what products",
    "show products",
    "show me products",
    "show catalog",
    "catalog",
    "what do you sell",
    "products"
  ]);

const isResetOrder = (message: string): boolean =>
  containsAny(normalizeText(message), [
    "new order",
    "new product",
    "different product",
    "change product",
    "start over",
    "reset order",
    "cancel order"
  ]);

const hasOrderLanguage = (message: string): boolean =>
  containsAny(normalizeText(message), [
    "order",
    "buy",
    "purchase",
    "deliver",
    "send",
    "want",
    "need"
  ]);

const isGenericPriceQuestion = (message: string): boolean => {
  const normalized = normalizeText(message);
  return normalized === "price" || normalized === "prices" || normalized === "pricing";
};

const heuristicIntent = (message: string, session: OrderSession | null): Intent => {
  const normalized = normalizeText(message);
  const activeSession = session?.status === "open" ? session : null;

  if (isGreeting(message) && !hasOrderLanguage(message) && !isCatalogBrowse(message)) {
    return "greeting";
  }

  if (isCatalogBrowse(message)) {
    return "browse_catalog";
  }

  if (isResetOrder(message)) {
    return "new_order";
  }

  if (hasOrderLanguage(message)) {
    return activeSession ? "order_intent" : "new_order";
  }

  if (
    isGenericPriceQuestion(message) ||
    containsAny(normalized, ["price", "cost", "how much", "rate", "mrp"])
  ) {
    return "price_question";
  }

  if (containsAny(normalized, ["shipping", "delivery", "arrive", "cod", "cash on delivery"])) {
    return "shipping_question";
  }

  if (activeSession) {
    return "order_intent";
  }

  if (/^[a-z\s]{2,40}$/i.test(message.trim())) {
    return "product_question";
  }

  return "product_question";
};

const cleanProductCandidate = (value: string): string | null => {
  const candidate = (value
    .split(/\b(?:my name is|i am|this is|for|to|in)\b/i)[0] ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const normalized = normalizeText(candidate);

  if (
    candidate.length < 3 ||
    containsAny(normalized, [
      "to order",
      "new product",
      "something",
      "anything",
      "price",
      "prices",
      "product"
    ])
  ) {
    return null;
  }

  return candidate;
};

const extractExplicitProductQuery = (message: string): string | null => {
  const normalized = normalizeText(message);
  if (containsAny(normalized, ["something", "anything", "item", "product", "stuff"])) {
    return null;
  }

  const patterns = [
    /\b(?:price|cost|mrp|rate)\s+(?:of|for)\s+([a-z][a-z\s]{2,60})/i,
    /\bwant\s+(?:to\s+order\s+)?(?:an?\s+|some\s+|the\s+)?(?:\d+\s+)?([a-z][a-z\s]{2,60})/i,
    /\b(?:order|buy|get|need)\s+(?:an?\s+|some\s+|the\s+)?(?:\d+\s+)?([a-z][a-z\s]{2,60})/i
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    const candidate = match?.[1] ? cleanProductCandidate(match[1]) : null;
    if (candidate) {
      return candidate;
    }
  }

  return null;
};

const missingFieldsFor = (fields: {
  readonly name: string | null;
  readonly productQuery: string | null;
  readonly quantity: number | null;
  readonly cityOrPincode: string | null;
}): ReadonlyArray<"name" | "product" | "quantity" | "cityOrPincode"> => {
  const missing: Array<"name" | "product" | "quantity" | "cityOrPincode"> = [];
  if (!fields.name) missing.push("name");
  if (!fields.productQuery) missing.push("product");
  if (!fields.quantity) missing.push("quantity");
  if (!fields.cityOrPincode) missing.push("cityOrPincode");
  return missing;
};

const summarizeProductList = (search: ProductSearchResult, limit = 3): string => {
  const pool = search.matches.length > 0 ? search.matches : search.alternatives;
  return pool
    .slice(0, limit)
    .map((item) => `${item.name} - INR ${item.price}. ${item.description}`)
    .join("\n");
};

const buildHeuristicPlan = (input: PlanTurnInput): TurnPlan => {
  const activeSession = input.session?.status === "open" ? input.session : null;
  const customerName = input.session?.name;
  const intent = heuristicIntent(input.userMessage, input.session);
  const matchedProduct =
    input.productSearch?.query !== "catalog" ? input.productSearch?.matches.at(0) ?? null : null;
  const extraction = {
    name: extractName(input.userMessage) ?? activeSession?.name ?? null,
    productQuery:
      matchedProduct?.name ??
      activeSession?.product ??
      extractExplicitProductQuery(input.userMessage),
    quantity: extractQuantity(input.userMessage) ?? activeSession?.quantity ?? null,
    cityOrPincode:
      extractCityOrPincode(input.userMessage, activeSession) ??
      activeSession?.cityOrPincode ??
      null
  };

  const missingFields = missingFieldsFor(extraction);
  const selectedProductId = matchedProduct?.id ?? activeSession?.selectedProductId ?? null;

  if (intent === "greeting") {
    return decodeTurnPlan({
      intent,
      action: "greet_user",
      extractedFields: extraction,
      missingFields: [],
      selectedProductId: null,
      requestedTools: [],
      replyText: customerName
        ? `Hi ${customerName}! I can help you browse products, check prices, answer shipping questions, or start a new order.`
        : "Hi! I can help you browse products, check prices, answer shipping questions, or place an order.",
      confidence: 0.98,
      provider: "heuristic"
    });
  }

  if (intent === "browse_catalog") {
    const result = input.productSearch;
    return decodeTurnPlan({
      intent,
      action: "answer_catalog_overview",
      extractedFields: extraction,
      missingFields: [],
      selectedProductId: null,
      requestedTools: result
        ? []
        : [{ name: "listCatalog", reason: "Need a short catalog overview for browsing request." }],
      replyText: result
        ? `Here are some products we currently have:\n${summarizeProductList(result, 4)}`
        : "I can show you our products. Let me pull up a few options from the catalog.",
      confidence: result ? 0.95 : 0.55,
      provider: "heuristic"
    });
  }

  if (intent === "shipping_question") {
    const faq = input.faqSearch?.match;
    return decodeTurnPlan({
      intent,
      action: "answer_faq",
      extractedFields: extraction,
      missingFields,
      selectedProductId,
      requestedTools: input.faqSearch
        ? []
        : [{ name: "searchFaq", reason: "Need shipping or policy answer." }],
      replyText: faq
        ? faq.answer
        : "I can help with shipping and policy questions from the FAQ. Tell me what you want to know.",
      confidence: faq ? 0.9 : 0.5,
      provider: "heuristic"
    });
  }

  if (intent === "price_question") {
    const explicitProductQuery = extractExplicitProductQuery(input.userMessage);

    if (!input.productSearch && !explicitProductQuery && !activeSession?.product) {
      return decodeTurnPlan({
        intent: "clarify",
        action: "clarify_request",
        extractedFields: extraction,
        missingFields: [],
        selectedProductId: null,
        requestedTools: [],
        replyText: "Sure. Which product would you like the price for?",
        confidence: 0.9,
        provider: "heuristic"
      });
    }

    if (!input.productSearch && (explicitProductQuery || activeSession?.product)) {
      return decodeTurnPlan({
        intent,
        action: "answer_product_details",
        extractedFields: extraction,
        missingFields: [],
        selectedProductId: activeSession?.selectedProductId ?? null,
        requestedTools: [
          { name: "searchProducts", reason: "Need product match to answer price question." }
        ],
        replyText: "Let me check that product in the catalog.",
        confidence: 0.7,
        provider: "heuristic"
      });
    }

    const product = input.productSearch?.matches.at(0);
    return decodeTurnPlan({
      intent,
      action: "answer_product_details",
      extractedFields: extraction,
      missingFields,
      selectedProductId,
      requestedTools: input.productSearch
        ? []
        : [{ name: "searchProducts", reason: "Need product match to answer price question." }],
      replyText: product
        ? `${product.name} costs INR ${product.price}. ${product.description}`
        : "I could not find that exact item in the catalog. Here are some available options:\n" +
          summarizeProductList(
            input.productSearch ?? {
              query: input.userMessage,
              matches: [],
              alternatives: []
            }
          ),
      confidence: product ? 0.92 : 0.55,
      provider: "heuristic"
    });
  }

  if (intent === "new_order") {
    const missingForFreshOrder = missingFieldsFor({
      name: extraction.name,
      productQuery: extraction.productQuery,
      quantity: extraction.quantity,
      cityOrPincode: extraction.cityOrPincode
    });
    const bundledFreshFields = missingForFreshOrder.map((field) =>
      field === "name"
        ? "your name"
        : field === "product"
          ? "the product you want"
          : field === "quantity"
            ? "the quantity"
            : "your city or pincode"
    );
    const newOrderAction =
      missingForFreshOrder.length === 0
        ? "confirm_order"
        : matchedProduct
          ? "collect_order_details"
          : "reset_order";
    const catalogReply =
      missingForFreshOrder.length === 0
        ? `Thanks ${extraction.name}. I have your order for ${extraction.quantity} x ${extraction.productQuery} to ${extraction.cityOrPincode}. Our team will contact you shortly.`
        : input.productSearch &&
            input.productSearch.query !== "catalog" &&
            input.productSearch.matches.length === 0
          ? `Sure, let's start a fresh order. I do not have that exact item in the catalog. Here are some available options:\n${summarizeProductList(input.productSearch)}`
          : matchedProduct
            ? (() => {
                const remainingLabels = bundledFreshFields.filter(
                  (label) => label !== "the product you want"
                );
                return remainingLabels.length > 0
                  ? `Sure, let's start a fresh order. I found ${matchedProduct.name}. Please share ${remainingLabels.join(" and ")}.`
                  : `Sure, let's start a fresh order with ${matchedProduct.name}.`;
              })()
            : input.productSearch?.query === "catalog"
              ? `Sure, let's start a fresh order. Please share ${bundledFreshFields.join(" and ")}. Here are a few options:\n${summarizeProductList(input.productSearch, 4)}`
              : `Sure, let's start a fresh order. Please share ${bundledFreshFields.join(" and ")}. I can also show you the catalog.`;

    return decodeTurnPlan({
      intent,
      action: newOrderAction,
      extractedFields: extraction,
      missingFields: missingForFreshOrder,
      selectedProductId,
      requestedTools:
        extraction.productQuery && !matchedProduct
          ? [{ name: "searchProducts", reason: "Need product match before starting a new order." }]
          : extraction.productQuery || matchedProduct
            ? []
            : [{ name: "listCatalog", reason: "Need catalog options while starting a fresh order." }],
      replyText: catalogReply,
      confidence: 0.92,
      provider: "heuristic"
    });
  }

  if (intent === "product_question" && !activeSession) {
    const result = input.productSearch;
    const noMatch = result && result.matches.length === 0;
    const replyText = result
      ? noMatch
        ? `I do not have that exact item in the catalog. Here are some available options you can choose from:\n${summarizeProductList(result)}`
        : `Here are some products from the catalog:\n${summarizeProductList(result)}`
      : "Let me look through the catalog and suggest a few options for you.";

    return decodeTurnPlan({
      intent,
      action: "answer_product_suggestions",
      extractedFields: extraction,
      missingFields,
      selectedProductId,
      requestedTools: result
        ? []
        : [{ name: "searchProducts", reason: "Need product suggestions from catalog." }],
      replyText,
      confidence: result ? 0.88 : 0.45,
      provider: "heuristic"
    });
  }

  if (intent === "clarify") {
    return decodeTurnPlan({
      intent,
      action: "clarify_request",
      extractedFields: extraction,
      missingFields: [],
      selectedProductId,
      requestedTools: [],
      replyText:
        "I can help with products, prices, shipping, or a new order. What would you like to do?",
      confidence: 0.7,
      provider: "heuristic"
    });
  }

  const canConfirm = missingFields.length === 0;
  const pendingFields = missingFields.map((field) => {
    switch (field) {
      case "name":
        return "your name";
      case "product":
        return "the product you want";
      case "quantity":
        return "the quantity";
      case "cityOrPincode":
        return "your city or pincode";
    }
  });

  return decodeTurnPlan({
    intent: "order_intent",
    action: canConfirm ? "confirm_order" : "collect_order_details",
    extractedFields: extraction,
    missingFields,
    selectedProductId,
    requestedTools: input.productSearch
      ? []
      : [{ name: "searchProducts", reason: "Need to map requested product to catalog item." }],
    replyText: canConfirm
      ? `Thanks ${extraction.name}. I have your order for ${extraction.quantity} x ${extraction.productQuery} to ${extraction.cityOrPincode}. Our team will contact you shortly.`
      : `I can help with that order. Please share ${pendingFields.join(" and ")}.`,
    confidence: canConfirm ? 0.94 : 0.8,
    provider: "heuristic"
  });
};

export { buildHeuristicPlan, missingFieldsFor };
