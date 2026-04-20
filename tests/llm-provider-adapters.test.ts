import { describe, expect, it } from "vitest";

import {
  buildProviderResponseSchema,
  parseStructuredProviderResponse,
  parseTextJsonProviderResponse
} from "../src/services/llm/provider-adapters.js";
import type { PlanTurnInput } from "../src/services/llm/types.js";

const baseInput: PlanTurnInput = {
  userMessage: "Hi",
  session: null
};

describe("LLM provider adapters", () => {
  it("builds Gemini schema with provider stripped and ordered nullable fields", () => {
    const schema = buildProviderResponseSchema("gemini");
    const properties = schema.properties as Record<string, unknown>;
    const extractedFields = properties.extractedFields as Record<string, unknown>;
    const extractedFieldProperties = extractedFields.properties as Record<string, unknown>;
    const nameSchema = extractedFieldProperties.name as Record<string, unknown>;

    expect(properties.provider).toBeUndefined();
    expect(schema.propertyOrdering).toEqual([
      "intent",
      "action",
      "extractedFields",
      "missingFields",
      "selectedProductId",
      "requestedTools",
      "replyText",
      "confidence"
    ]);
    expect(extractedFields.propertyOrdering).toEqual([
      "name",
      "productQuery",
      "quantity",
      "cityOrPincode"
    ]);
    expect(nameSchema.type).toEqual(["string", "null"]);
  });

  it("builds canonical schema for future structured providers without Gemini-specific rewrites", () => {
    const schema = buildProviderResponseSchema("openai");
    const properties = schema.properties as Record<string, unknown>;
    const extractedFields = properties.extractedFields as Record<string, unknown>;
    const extractedFieldProperties = extractedFields.properties as Record<string, unknown>;
    const nameSchema = extractedFieldProperties.name as Record<string, unknown>;

    expect(properties.provider).toBeUndefined();
    expect(schema.propertyOrdering).toBeUndefined();
    expect(nameSchema.anyOf).toEqual([{ type: "string" }, { type: "null" }]);
  });

  it("parses strict structured provider responses through the shared effect boundary", () => {
    const plan = parseStructuredProviderResponse(
      "gemini",
      JSON.stringify({
        intent: "browse_catalog",
        action: "browse_catalog",
        extractedFields: {},
        missingFields: [],
        selectedProductId: null,
        requestedTools: ["get_catalog"],
        replyText: "Here is our catalog.",
        confidence: 1
      }),
      baseInput
    );

    expect(plan.provider).toBe("gemini");
    expect(plan.intent).toBe("browse_catalog");
    expect(plan.action).toBe("answer_catalog_overview");
    expect(plan.extractedFields).toEqual({
      name: null,
      productQuery: null,
      quantity: null,
      cityOrPincode: null
    });
    expect(plan.requestedTools).toEqual([
      { name: "listCatalog", reason: "Requested by model as get_catalog." }
    ]);
  });

  it("parses text-json provider responses through the tolerant adapter path", () => {
    const plan = parseTextJsonProviderResponse(
      "openrouter",
      "Here is the plan:\n```json\n" +
        JSON.stringify({
          intent: "product-question",
          action: "product_question",
          extractedFields: { productQuery: "protein granola" },
          missingFields: [],
          selectedProductId: null,
          requestedTools: [{ name: "search_products" }],
          replyText: "Let me find the best match.",
          confidence: 0.82
        }) +
        "\n```",
      baseInput
    );

    expect(plan.provider).toBe("openrouter");
    expect(plan.intent).toBe("product_question");
    expect(plan.action).toBe("answer_product_suggestions");
    expect(plan.extractedFields).toEqual({
      name: null,
      productQuery: "protein granola",
      quantity: null,
      cityOrPincode: null
    });
    expect(plan.requestedTools).toEqual([
      { name: "searchProducts", reason: "Requested by model as search_products." }
    ]);
  });
});
