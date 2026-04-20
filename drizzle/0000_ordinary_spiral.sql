CREATE TABLE `inbound_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`phone` text NOT NULL,
	`text` text NOT NULL,
	`message_id` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`received_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_events_message_id_unique` ON `inbound_events` (`message_id`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_message_id` text NOT NULL,
	`phone` text NOT NULL,
	`name` text NOT NULL,
	`product` text NOT NULL,
	`quantity` integer NOT NULL,
	`city_or_pincode` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_source_message_id_unique` ON `leads` (`source_message_id`);--> statement-breakpoint
CREATE TABLE `order_sessions` (
	`phone` text PRIMARY KEY NOT NULL,
	`name` text,
	`product` text,
	`quantity` integer,
	`city_or_pincode` text,
	`selected_product_id` text,
	`candidate_product_ids` text DEFAULT '[]' NOT NULL,
	`missing_fields` text DEFAULT '[]' NOT NULL,
	`last_asked_follow_up` text,
	`clarification_count` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL
);
