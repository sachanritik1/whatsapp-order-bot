import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const inboundEventsTable = sqliteTable("inbound_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  phone: text("phone").notNull(),
  text: text("text").notNull(),
  messageId: text("message_id").notNull().unique(),
  status: text("status").notNull(),
  attempts: integer("attempts").notNull().default(0),
  errorMessage: text("error_message"),
  receivedAt: text("received_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const orderSessionsTable = sqliteTable("order_sessions", {
  phone: text("phone").primaryKey(),
  name: text("name"),
  product: text("product"),
  quantity: integer("quantity"),
  cityOrPincode: text("city_or_pincode"),
  selectedProductId: text("selected_product_id"),
  candidateProductIds: text("candidate_product_ids").notNull().default("[]"),
  missingFields: text("missing_fields").notNull().default("[]"),
  lastAskedFollowUp: text("last_asked_follow_up"),
  clarificationCount: integer("clarification_count").notNull().default(0),
  status: text("status").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const leadsTable = sqliteTable("leads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceMessageId: text("source_message_id").notNull().unique(),
  phone: text("phone").notNull(),
  name: text("name").notNull(),
  product: text("product").notNull(),
  quantity: integer("quantity").notNull(),
  cityOrPincode: text("city_or_pincode").notNull(),
  createdAt: text("created_at").notNull()
});

export const drizzleSchema = {
  inboundEvents: inboundEventsTable,
  orderSessions: orderSessionsTable,
  leads: leadsTable
};
