CREATE TABLE `market_data_request_budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`budget_window_key` text NOT NULL,
	`provider_timezone` text NOT NULL,
	`daily_limit` integer NOT NULL,
	`soft_limit` integer NOT NULL,
	`safety_reserve` integer NOT NULL,
	`requests_reserved` integer DEFAULT 0 NOT NULL,
	`requests_completed` integer DEFAULT 0 NOT NULL,
	`window_reset_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_data_request_budgets_source_window_idx` ON `market_data_request_budgets` (`source`,`budget_window_key`);--> statement-breakpoint
CREATE TABLE `market_data_sync_statuses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`normalized_code` text NOT NULL,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`last_attempted_at` text,
	`last_success_at` text,
	`next_allowed_at` text,
	`ttl_seconds` integer,
	`as_of` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_data_sync_statuses_source_code_stage_idx` ON `market_data_sync_statuses` (`source`,`normalized_code`,`stage`);--> statement-breakpoint
CREATE INDEX `market_data_sync_statuses_status_idx` ON `market_data_sync_statuses` (`status`);--> statement-breakpoint
CREATE TABLE `stock_dividend_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stock_market_data_id` integer NOT NULL,
	`provider_event_id` text,
	`economic_event_key` text NOT NULL,
	`event_version_key` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`fiscal_year` integer NOT NULL,
	`payment_year` integer,
	`period` text,
	`status` text NOT NULL,
	`dps_raw` real,
	`dps_adjusted` real,
	`period_basis` text NOT NULL,
	`announced_at` text,
	`record_date` text,
	`ex_date` text,
	`payment_date` text,
	`payment_date_precision` text NOT NULL,
	`source` text NOT NULL,
	`as_of` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`stock_market_data_id`) REFERENCES `stock_market_data`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_dividend_history_source_event_version_idx` ON `stock_dividend_history` (`source`,`event_version_key`);--> statement-breakpoint
CREATE INDEX `stock_dividend_history_stock_fiscal_idx` ON `stock_dividend_history` (`stock_market_data_id`,`fiscal_year`);--> statement-breakpoint
CREATE INDEX `stock_dividend_history_payment_date_idx` ON `stock_dividend_history` (`payment_date`);--> statement-breakpoint
CREATE TABLE `stock_market_data` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`external_security_id` text NOT NULL,
	`normalized_code` text NOT NULL,
	`market` text,
	`name` text NOT NULL,
	`industry_name` text,
	`listing_status` text NOT NULL,
	`mapping_status` text NOT NULL,
	`forecast_fiscal_year` integer,
	`forecast_quarter` text,
	`forecast_dps_raw` real,
	`forecast_dps_adjusted` real,
	`forecast_share_basis` text,
	`forecast_period_basis` text,
	`forecast_source_disclosure_date` text,
	`forecast_as_of` text,
	`last_mapped_at` text,
	`last_forecast_fetched_at` text,
	`last_history_fetched_at` text,
	`last_error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_market_data_source_external_idx` ON `stock_market_data` (`source`,`external_security_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `stock_market_data_source_code_idx` ON `stock_market_data` (`source`,`normalized_code`);--> statement-breakpoint
CREATE INDEX `stock_market_data_industry_idx` ON `stock_market_data` (`industry_name`);--> statement-breakpoint
CREATE INDEX `stock_market_data_mapping_status_idx` ON `stock_market_data` (`mapping_status`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `raw_category` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `raw_sub_category` text;