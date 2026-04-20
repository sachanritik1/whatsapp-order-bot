import { JSONSchema, Schema } from "effect";

import { IntegrationError } from "../../errors.js";
import { logWarn, serializeForLog } from "../../logging.js";
import {
  type Intent,
  TurnPlanSchema,
  type ToolCall,
  type ToolName,
  type TurnAction,
  type TurnPlan
} from "../../schema.js";
import { buildHeuristicPlan, missingFieldsFor } from "./heuristics.js";
import type { PlanTurnInput, RemoteTurnPlanProvider } from "./types.js";

const decodeTurnPlan = Schema.decodeUnknownSync(TurnPlanSchema);

export type JsonRecord = Record<string, unknown>;
export type StructuredOutputProvider = "gemini" | "openai";
export type TextJsonProvider = RemoteTurnPlanProvider | "anthropic";
export type RemoteProviderAdapterName = StructuredOutputProvider | TextJsonProvider;

const isJsonRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSingleTypeSchema = (value: unknown): value is { readonly type: string } =>
  isJsonRecord(value) &&
  typeof value.type === "string" &&
  Object.keys(value).length === 1;

const buildCanonicalTurnPlanJsonSchema = (): JsonRecord => {
  const jsonSchema = structuredClone(JSONSchema.make(TurnPlanSchema) as unknown as JsonRecord);
  const properties = isJsonRecord(jsonSchema.properties) ? jsonSchema.properties : {};
  const required = Array.isArray(jsonSchema.required) ? jsonSchema.required : [];

  delete properties.provider;
  jsonSchema.properties = properties;
  jsonSchema.required = required.filter((field) => field !== "provider");

  return jsonSchema;
};

const CANONICAL_TURN_PLAN_JSON_SCHEMA = buildCanonicalTurnPlanJsonSchema();

const toGeminiCompatibleJsonSchema = (node: unknown): unknown => {
  if (Array.isArray(node)) {
    return node.map((item) => toGeminiCompatibleJsonSchema(item));
  }

  if (!isJsonRecord(node)) {
    return node;
  }

  const converted: JsonRecord = {};

  for (const [key, value] of Object.entries(node)) {
    if (key === "$schema") {
      continue;
    }

    converted[key] = toGeminiCompatibleJsonSchema(value);
  }

  if (Array.isArray(converted.anyOf) && converted.anyOf.length === 2) {
    const nullableMembers = converted.anyOf.filter(isSingleTypeSchema);
    const includesNull = nullableMembers.some((member) => member.type === "null");
    const nonNullTypes = nullableMembers
      .map((member) => member.type)
      .filter((type) => type !== "null");

    if (includesNull && nullableMembers.length === converted.anyOf.length && nonNullTypes.length > 0) {
      delete converted.anyOf;
      converted.type = [...new Set([...nonNullTypes, "null"])];
    }
  }

  if (converted.type === "object" && isJsonRecord(converted.properties)) {
    converted.propertyOrdering = Object.keys(converted.properties);
  }

  return converted;
};

const normalizeExtractedFields = (
  parsed: Record<string, unknown>,
  input: PlanTurnInput
) => {
  const heuristic = buildHeuristicPlan(input);
  const extractedFields =
    typeof parsed.extractedFields === "object" && parsed.extractedFields !== null
      ? (parsed.extractedFields as Record<string, unknown>)
      : {};

  return {
    name:
      typeof extractedFields.name === "string" || extractedFields.name === null
        ? extractedFields.name
        : heuristic.extractedFields.name,
    productQuery:
      typeof extractedFields.productQuery === "string" || extractedFields.productQuery === null
        ? extractedFields.productQuery
        : heuristic.extractedFields.productQuery,
    quantity:
      typeof extractedFields.quantity === "number" || extractedFields.quantity === null
        ? extractedFields.quantity
        : heuristic.extractedFields.quantity,
    cityOrPincode:
      typeof extractedFields.cityOrPincode === "string" || extractedFields.cityOrPincode === null
        ? extractedFields.cityOrPincode
        : heuristic.extractedFields.cityOrPincode
  };
};

const normalizeIntent = (intent: unknown, fallbackIntent: Intent): Intent => {
  if (typeof intent !== "string") {
    return fallbackIntent;
  }

  switch (intent) {
    case "greeting":
    case "browse_catalog":
    case "product_question":
    case "price_question":
    case "shipping_question":
    case "order_intent":
    case "new_order":
    case "clarify":
    case "fallback":
      return intent;
    case "browse-catalog":
      return "browse_catalog";
    case "product-question":
      return "product_question";
    case "price-question":
      return "price_question";
    case "shipping-question":
      return "shipping_question";
    case "order-intent":
      return "order_intent";
    case "new-order":
      return "new_order";
    default:
      return fallbackIntent;
  }
};

const normalizeAction = (
  action: unknown,
  intent: unknown,
  heuristicAction: TurnAction
): TurnAction => {
  if (typeof action !== "string") {
    return heuristicAction;
  }

  switch (action) {
    case "greet_user":
    case "answer_catalog_overview":
    case "answer_product_suggestions":
    case "answer_product_details":
    case "answer_faq":
    case "collect_order_details":
    case "confirm_order":
    case "reset_order":
    case "clarify_request":
    case "fallback":
      return action;
    case "browse_catalog":
      return "answer_catalog_overview";
    case "product_question":
      return "answer_product_suggestions";
    case "price_question":
      return "answer_product_details";
    case "shipping_question":
      return "answer_faq";
    case "order_intent":
      return "collect_order_details";
    case "new_order":
      return "reset_order";
    case "clarify":
      return "clarify_request";
    default:
      if (intent === "greeting") return "greet_user";
      if (intent === "browse_catalog" || intent === "browse-catalog") return "answer_catalog_overview";
      if (intent === "product_question" || intent === "product-question") return "answer_product_suggestions";
      if (intent === "price_question" || intent === "price-question") return "answer_product_details";
      if (intent === "shipping_question" || intent === "shipping-question") return "answer_faq";
      if (intent === "clarify") return "clarify_request";
      return heuristicAction;
  }
};

const normalizeToolName = (name: string): ToolName | null => {
  switch (name) {
    case "listCatalog":
    case "searchProducts":
    case "getProductDetails":
    case "searchFaq":
    case "getSession":
    case "updateSession":
    case "createLeadFromSession":
      return name;
    case "get_catalog":
    case "list_products":
    case "show_catalog":
      return "listCatalog";
    case "search_products":
      return "searchProducts";
    case "get_product_details":
      return "getProductDetails";
    case "search_faq":
      return "searchFaq";
    case "get_session":
      return "getSession";
    case "update_session":
      return "updateSession";
    case "create_lead":
    case "create_lead_from_session":
      return "createLeadFromSession";
    default:
      return null;
  }
};

const normalizeRequestedTools = (
  requestedTools: unknown,
  fallback: ReadonlyArray<ToolCall>
): ReadonlyArray<ToolCall> => {
  if (!Array.isArray(requestedTools)) {
    return fallback;
  }

  const normalized = requestedTools.flatMap((tool): ReadonlyArray<ToolCall> => {
    if (typeof tool === "string") {
      const normalizedName = normalizeToolName(tool);
      return normalizedName
        ? [{ name: normalizedName, reason: `Requested by model as ${tool}.` }]
        : [];
    }

    if (typeof tool === "object" && tool !== null) {
      const record = tool as Record<string, unknown>;
      if (typeof record.name === "string") {
        const normalizedName = normalizeToolName(record.name);
        return normalizedName
          ? [{
              name: normalizedName,
              reason:
                typeof record.reason === "string"
                  ? record.reason
                  : `Requested by model as ${record.name}.`
            }]
          : [];
      }
    }

    return [];
  });

  return normalized.length > 0 ? normalized : fallback;
};

const coerceParsedTurnPlan = (
  parsed: Record<string, unknown>,
  input: PlanTurnInput,
  provider: RemoteTurnPlanProvider
) => {
  const heuristic = buildHeuristicPlan(input);
  const normalizedIntent = normalizeIntent(parsed.intent, heuristic.intent);
  const extractedFields = normalizeExtractedFields(parsed, input);
  const missingFields = missingFieldsFor(extractedFields);
  const selectedProductId =
    typeof parsed.selectedProductId === "string" || parsed.selectedProductId === null
      ? parsed.selectedProductId
      : heuristic.selectedProductId;
  const requestedTools = normalizeRequestedTools(parsed.requestedTools, heuristic.requestedTools);
  const confidence =
    typeof parsed.confidence === "number" ? parsed.confidence : heuristic.confidence;

  return {
    intent: normalizedIntent,
    action: normalizeAction(parsed.action, normalizedIntent, heuristic.action),
    extractedFields,
    missingFields:
      Array.isArray(parsed.missingFields) && parsed.missingFields.every((field) => typeof field === "string")
        ? parsed.missingFields
        : missingFields,
    selectedProductId,
    requestedTools,
    replyText:
      typeof parsed.replyText === "string" ? parsed.replyText : heuristic.replyText,
    confidence,
    provider
  };
};

const normalizeAlternateTurnPlan = (
  parsed: Record<string, unknown>,
  input: PlanTurnInput,
  provider: RemoteTurnPlanProvider
): TurnPlan | null => {
  const firstMessage =
    Array.isArray(parsed.messages) &&
    typeof parsed.messages[0] === "object" &&
    parsed.messages[0] !== null
      ? (parsed.messages[0] as { readonly content?: unknown })
      : null;
  const firstAction =
    Array.isArray(parsed.actions) &&
    typeof parsed.actions[0] === "object" &&
    parsed.actions[0] !== null
      ? (parsed.actions[0] as {
          readonly type?: unknown;
          readonly payload?: unknown;
          readonly orderDetails?: unknown;
        })
      : null;

  if (!firstMessage && !firstAction) {
    return null;
  }

  const heuristic = buildHeuristicPlan(input);
  const orderDetails =
    firstAction &&
    typeof firstAction.orderDetails === "object" &&
    firstAction.orderDetails !== null
      ? (firstAction.orderDetails as {
          readonly customerName?: unknown;
          readonly product?: unknown;
          readonly quantity?: unknown;
          readonly cityOrPincode?: unknown;
        })
      : null;
  const sendPayload =
    firstAction && typeof firstAction.payload === "object" && firstAction.payload !== null
      ? (firstAction.payload as { readonly text?: unknown })
      : null;

  const extraction = {
    name:
      (typeof orderDetails?.customerName === "string" ? orderDetails.customerName : null) ??
      heuristic.extractedFields.name,
    productQuery:
      (typeof orderDetails?.product === "string" ? orderDetails.product : null) ??
      heuristic.extractedFields.productQuery,
    quantity:
      typeof orderDetails?.quantity === "number"
        ? orderDetails.quantity
        : heuristic.extractedFields.quantity,
    cityOrPincode:
      (typeof orderDetails?.cityOrPincode === "string" ? orderDetails.cityOrPincode : null) ??
      heuristic.extractedFields.cityOrPincode
  };

  const selectedProductId =
    input.productSearch?.matches.find((item) => item.name === extraction.productQuery)?.id ??
    heuristic.selectedProductId;
  const missingFields = missingFieldsFor(extraction);
  const replyText =
    (typeof firstMessage?.content === "string" ? firstMessage.content : null) ??
    (typeof sendPayload?.text === "string" ? sendPayload.text : null) ??
    heuristic.replyText;
  const action =
    firstAction?.type === "orderConfirmation"
      ? "confirm_order"
      : firstAction?.type === "sendMessage" && missingFields.length > 0
        ? "collect_order_details"
        : heuristic.action;

  return {
    intent: heuristic.intent,
    action,
    extractedFields: extraction,
    missingFields,
    selectedProductId,
    requestedTools: [],
    replyText,
    confidence: heuristic.confidence,
    provider
  };
};

const stripMarkdownCodeFence = (content: string): string | null => {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? null;
};

const extractFirstJsonObject = (content: string): string | null => {
  const start = content.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < content.length; index += 1) {
    const char = content[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(start, index + 1);
      }
    }
  }

  return null;
};

const buildJsonCandidates = (content: string): ReadonlyArray<string> => {
  const trimmed = content.trim();
  const candidates = new Set<string>([trimmed]);
  const fenced = stripMarkdownCodeFence(trimmed);

  if (fenced) {
    candidates.add(fenced);
  }

  const embedded = extractFirstJsonObject(trimmed);
  if (embedded) {
    candidates.add(embedded.trim());
  }

  if (fenced) {
    const embeddedFromFence = extractFirstJsonObject(fenced);
    if (embeddedFromFence) {
      candidates.add(embeddedFromFence.trim());
    }
  }

  return Array.from(candidates).filter((candidate) => candidate.length > 0);
};

const parseObjectJson = (
  provider: RemoteProviderAdapterName,
  content: string,
  invalidMessage: string,
  nonObjectMessage: string
): JsonRecord => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    throw new IntegrationError({
      service: provider === "openai" || provider === "anthropic" ? "openrouter" : provider,
      message: invalidMessage,
      cause: {
        rawContent: content,
        parseError: serializeForLog(cause)
      }
    });
  }

  if (!isJsonRecord(parsed)) {
    throw new IntegrationError({
      service: provider === "openai" || provider === "anthropic" ? "openrouter" : provider,
      message: nonObjectMessage,
      cause: {
        rawContent: content,
        parsed
      }
    });
  }

  return parsed;
};

const remoteServiceName = (provider: RemoteProviderAdapterName): RemoteTurnPlanProvider =>
  provider === "gemini" ? "gemini" : "openrouter";

export const buildProviderResponseSchema = (
  provider: RemoteProviderAdapterName
): JsonRecord => {
  if (provider === "gemini") {
    return toGeminiCompatibleJsonSchema(CANONICAL_TURN_PLAN_JSON_SCHEMA) as JsonRecord;
  }

  return structuredClone(CANONICAL_TURN_PLAN_JSON_SCHEMA);
};

export const parseStructuredProviderResponse = (
  provider: StructuredOutputProvider,
  content: string,
  input: PlanTurnInput
): TurnPlan => {
  const parsed = parseObjectJson(
    provider,
    content,
    `${provider === "gemini" ? "Gemini" : "OpenAI"} returned invalid structured JSON content.`,
    `${provider === "gemini" ? "Gemini" : "OpenAI"} returned a non-object structured response.`
  );

  const coerced = coerceParsedTurnPlan(parsed, input, remoteServiceName(provider));

  try {
    return decodeTurnPlan(coerced);
  } catch (cause) {
    throw new IntegrationError({
      service: remoteServiceName(provider),
      message: `${provider === "gemini" ? "Gemini" : "OpenAI"} returned structured JSON that failed TurnPlan validation.`,
      cause: {
        rawContent: content,
        coercedCandidate: coerced,
        parseError: serializeForLog(cause)
      }
    });
  }
};

export const parseTextJsonProviderResponse = (
  provider: TextJsonProvider,
  content: string,
  input: PlanTurnInput
): TurnPlan => {
  const candidates = buildJsonCandidates(content);
  let lastCause: unknown = null;

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const coerced = coerceParsedTurnPlan(parsed, input, remoteServiceName(provider));

      try {
        return decodeTurnPlan(coerced);
      } catch (schemaCause) {
        const normalized = normalizeAlternateTurnPlan(parsed, input, remoteServiceName(provider));
        if (normalized) {
          logWarn(`${provider}.normalized_response`, {
            note: `Normalized non-standard ${provider} output into TurnPlan.`,
            rawContent: content
          });
          return normalized;
        }

        throw new IntegrationError({
          service: remoteServiceName(provider),
          message: `${provider} returned invalid TurnPlan JSON.`,
          cause: {
            rawContent: content,
            jsonCandidate: candidate,
            coercedCandidate: coerced,
            parseError: serializeForLog(schemaCause)
          }
        });
      }
    } catch (cause) {
      lastCause = cause;
    }
  }

  throw new IntegrationError({
    service: remoteServiceName(provider),
    message: `${provider} returned invalid JSON content.`,
    cause: {
      rawContent: content,
      jsonCandidates: candidates,
      parseError: serializeForLog(lastCause)
    }
  });
};
