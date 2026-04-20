import { Schema } from "effect";

export const IntentSchema = Schema.Literal(
  "greeting",
  "browse_catalog",
  "product_question",
  "price_question",
  "shipping_question",
  "order_intent",
  "new_order",
  "clarify",
  "fallback"
);
export type Intent = typeof IntentSchema.Type;

export const CatalogItemSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  price: Schema.Number,
  currency: Schema.String,
  tags: Schema.Array(Schema.String)
});
export type CatalogItem = typeof CatalogItemSchema.Type;

export const FaqEntrySchema = Schema.Struct({
  id: Schema.String,
  question: Schema.String,
  answer: Schema.String,
  tags: Schema.Array(Schema.String)
});
export type FaqEntry = typeof FaqEntrySchema.Type;

export const LeadSchema = Schema.Struct({
  id: Schema.Number,
  sourceMessageId: Schema.String,
  phone: Schema.String,
  name: Schema.String,
  product: Schema.String,
  quantity: Schema.Number,
  cityOrPincode: Schema.String,
  createdAt: Schema.String
});
export type Lead = typeof LeadSchema.Type;

export const OrderSessionStatusSchema = Schema.Literal("open", "completed");
export type OrderSessionStatus = typeof OrderSessionStatusSchema.Type;

export const OrderFieldSchema = Schema.Literal(
  "name",
  "product",
  "quantity",
  "cityOrPincode"
);
export type OrderField = typeof OrderFieldSchema.Type;

export const OrderSessionSchema = Schema.Struct({
  phone: Schema.String,
  name: Schema.NullOr(Schema.String),
  product: Schema.NullOr(Schema.String),
  quantity: Schema.NullOr(Schema.Number),
  cityOrPincode: Schema.NullOr(Schema.String),
  selectedProductId: Schema.NullOr(Schema.String),
  candidateProductIds: Schema.Array(Schema.String),
  missingFields: Schema.Array(OrderFieldSchema),
  lastAskedFollowUp: Schema.NullOr(Schema.String),
  clarificationCount: Schema.Number,
  status: OrderSessionStatusSchema,
  updatedAt: Schema.String
});
export type OrderSession = typeof OrderSessionSchema.Type;

export const InboundEventStatusSchema = Schema.Literal(
  "pending",
  "processing",
  "processed",
  "failed"
);
export type InboundEventStatus = typeof InboundEventStatusSchema.Type;

export const InboundEventSchema = Schema.Struct({
  id: Schema.Number,
  phone: Schema.String,
  text: Schema.String,
  messageId: Schema.String,
  status: InboundEventStatusSchema,
  attempts: Schema.Number,
  errorMessage: Schema.NullOr(Schema.String),
  receivedAt: Schema.String,
  updatedAt: Schema.String
});
export type InboundEvent = typeof InboundEventSchema.Type;

export const InboundMessageSchema = Schema.Struct({
  phone: Schema.String,
  text: Schema.String,
  messageId: Schema.String,
  receivedAt: Schema.String
});
export type InboundMessage = typeof InboundMessageSchema.Type;

export const ProductSearchHitSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  price: Schema.Number,
  currency: Schema.String,
  score: Schema.Number
});
export type ProductSearchHit = typeof ProductSearchHitSchema.Type;

export const ProductSearchResultSchema = Schema.Struct({
  query: Schema.String,
  matches: Schema.Array(ProductSearchHitSchema),
  alternatives: Schema.Array(ProductSearchHitSchema)
});
export type ProductSearchResult = typeof ProductSearchResultSchema.Type;

export const FaqSearchResultSchema = Schema.Struct({
  query: Schema.String,
  match: Schema.NullOr(FaqEntrySchema),
  score: Schema.Number
});
export type FaqSearchResult = typeof FaqSearchResultSchema.Type;

export const OrderExtractionSchema = Schema.Struct({
  name: Schema.NullOr(Schema.String),
  productQuery: Schema.NullOr(Schema.String),
  quantity: Schema.NullOr(Schema.Number),
  cityOrPincode: Schema.NullOr(Schema.String)
});
export type OrderExtraction = typeof OrderExtractionSchema.Type;

export const ToolNameSchema = Schema.Literal(
  "listCatalog",
  "searchProducts",
  "getProductDetails",
  "searchFaq",
  "getSession",
  "updateSession",
  "createLeadFromSession"
);
export type ToolName = typeof ToolNameSchema.Type;

export const ToolCallSchema = Schema.Struct({
  name: ToolNameSchema,
  reason: Schema.String
});
export type ToolCall = typeof ToolCallSchema.Type;

export const TurnActionSchema = Schema.Literal(
  "greet_user",
  "answer_catalog_overview",
  "answer_product_suggestions",
  "answer_product_details",
  "answer_faq",
  "collect_order_details",
  "confirm_order",
  "reset_order",
  "clarify_request",
  "fallback"
);
export type TurnAction = typeof TurnActionSchema.Type;

export const TurnPlanSchema = Schema.Struct({
  intent: IntentSchema,
  action: TurnActionSchema,
  extractedFields: OrderExtractionSchema,
  missingFields: Schema.Array(OrderFieldSchema),
  selectedProductId: Schema.NullOr(Schema.String),
  requestedTools: Schema.Array(ToolCallSchema),
  replyText: Schema.String,
  confidence: Schema.Number,
  provider: Schema.Literal("heuristic", "openrouter", "gemini")
});
export type TurnPlan = typeof TurnPlanSchema.Type;

const WhatsAppTextSchema = Schema.Struct({
  body: Schema.String
});

const WhatsAppMessageSchema = Schema.Struct({
  from: Schema.String,
  id: Schema.String,
  timestamp: Schema.String,
  type: Schema.Literal("text"),
  text: WhatsAppTextSchema
});

const WhatsAppChangeValueSchema = Schema.Struct({
  messages: Schema.optionalWith(Schema.Array(WhatsAppMessageSchema), {
    default: () => []
  })
});

const WhatsAppChangeSchema = Schema.Struct({
  field: Schema.String,
  value: WhatsAppChangeValueSchema
});

const WhatsAppEntrySchema = Schema.Struct({
  id: Schema.String,
  changes: Schema.Array(WhatsAppChangeSchema)
});

export const WhatsAppWebhookPayloadSchema = Schema.Struct({
  object: Schema.String,
  entry: Schema.Array(WhatsAppEntrySchema)
});
export type WhatsAppWebhookPayload = typeof WhatsAppWebhookPayloadSchema.Type;

export const LlmProviderSchema = Schema.Literal("openrouter", "gemini");
export type LlmProvider = typeof LlmProviderSchema.Type;

export const AppConfigSchema = Schema.Struct({
  port: Schema.Number,
  webhookVerifyToken: Schema.String,
  whatsappAccessToken: Schema.NullOr(Schema.String),
  whatsappPhoneNumberId: Schema.NullOr(Schema.String),
  llmProvider: Schema.NullOr(LlmProviderSchema),
  openRouterApiKey: Schema.NullOr(Schema.String),
  openRouterModel: Schema.NullOr(Schema.String),
  googleGeminiApiKey: Schema.NullOr(Schema.String),
  googleGeminiModel: Schema.NullOr(Schema.String),
  databaseFile: Schema.String,
  catalogFile: Schema.String,
  faqFile: Schema.String
});
export type AppConfig = typeof AppConfigSchema.Type;
