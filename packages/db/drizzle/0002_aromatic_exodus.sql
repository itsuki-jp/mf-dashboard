-- Existing rows cannot be assigned to a profile without an explicit mapping.
-- Abort before any persistent schema change and require a fresh database.
DROP TABLE IF EXISTS `_mf_profile_migration_guard`;
--> statement-breakpoint
CREATE TEMP TABLE `_mf_profile_migration_guard` (
	`must_be_empty` integer NOT NULL CHECK (`must_be_empty` = 0)
);
--> statement-breakpoint
INSERT INTO `_mf_profile_migration_guard` (`must_be_empty`)
SELECT
	(SELECT count(*) FROM `groups`) +
	(SELECT count(*) FROM `accounts`) +
	(SELECT count(*) FROM `group_accounts`) +
	(SELECT count(*) FROM `holdings`) +
	(SELECT count(*) FROM `transactions`);
--> statement-breakpoint
CREATE TABLE `money_forward_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_scraped_at` text,
	`last_status` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
DROP TABLE `group_accounts`;
--> statement-breakpoint
DROP TABLE `holdings`;
--> statement-breakpoint
DROP TABLE `transactions`;
--> statement-breakpoint
DROP INDEX `accounts_mf_id_unique`;
--> statement-breakpoint
ALTER TABLE `accounts` ADD `profile_id` text NOT NULL REFERENCES money_forward_profiles(id) ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_profile_mf_id_idx` ON `accounts` (`profile_id`,`mf_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_profile_id_pair_idx` ON `accounts` (`profile_id`,`id`);
--> statement-breakpoint
CREATE INDEX `accounts_profile_id_idx` ON `accounts` (`profile_id`);
--> statement-breakpoint
ALTER TABLE `groups` ADD `profile_id` text NOT NULL REFERENCES money_forward_profiles(id) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `groups` ADD `mf_group_id` text NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_profile_mf_group_idx` ON `groups` (`profile_id`,`mf_group_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_profile_id_pair_idx` ON `groups` (`profile_id`,`id`);
--> statement-breakpoint
CREATE INDEX `groups_profile_id_idx` ON `groups` (`profile_id`);
--> statement-breakpoint
CREATE TABLE `group_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text NOT NULL,
	`group_id` text NOT NULL,
	`account_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `money_forward_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`,`group_id`) REFERENCES `groups`(`profile_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`,`account_id`) REFERENCES `accounts`(`profile_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_accounts_group_account_idx` ON `group_accounts` (`group_id`,`account_id`);
--> statement-breakpoint
CREATE INDEX `group_accounts_group_id_idx` ON `group_accounts` (`group_id`);
--> statement-breakpoint
CREATE INDEX `group_accounts_account_id_idx` ON `group_accounts` (`account_id`);
--> statement-breakpoint
CREATE TABLE `holdings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text NOT NULL,
	`mf_id` text,
	`account_id` integer NOT NULL,
	`category_id` integer,
	`name` text NOT NULL,
	`code` text,
	`type` text NOT NULL,
	`liability_category` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`is_active` integer DEFAULT true,
	FOREIGN KEY (`profile_id`) REFERENCES `money_forward_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `asset_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`profile_id`,`account_id`) REFERENCES `accounts`(`profile_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holdings_profile_mf_id_idx` ON `holdings` (`profile_id`,`mf_id`);
--> statement-breakpoint
CREATE INDEX `holdings_profile_id_idx` ON `holdings` (`profile_id`);
--> statement-breakpoint
CREATE INDEX `holdings_account_id_idx` ON `holdings` (`account_id`);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text NOT NULL,
	`mf_id` text NOT NULL,
	`date` text NOT NULL,
	`account_id` integer,
	`category` text,
	`sub_category` text,
	`description` text,
	`amount` integer NOT NULL,
	`type` text NOT NULL,
	`is_transfer` integer DEFAULT false NOT NULL,
	`is_excluded_from_calculation` integer DEFAULT false NOT NULL,
	`transfer_target` text,
	`transfer_target_account_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `money_forward_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transfer_target_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`profile_id`,`account_id`) REFERENCES `accounts`(`profile_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_profile_mf_id_idx` ON `transactions` (`profile_id`,`mf_id`);
--> statement-breakpoint
CREATE INDEX `transactions_profile_id_idx` ON `transactions` (`profile_id`);
--> statement-breakpoint
CREATE INDEX `transactions_profile_date_idx` ON `transactions` (`profile_id`,`date`);
--> statement-breakpoint
CREATE INDEX `transactions_profile_account_idx` ON `transactions` (`profile_id`,`account_id`);
--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`date`);
--> statement-breakpoint
CREATE INDEX `transactions_account_id_idx` ON `transactions` (`account_id`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
DROP TABLE `_mf_profile_migration_guard`;
