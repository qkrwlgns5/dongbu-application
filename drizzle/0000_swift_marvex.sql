CREATE TABLE `admin_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_audit_created_idx` ON `admin_audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `app_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`active_tournament_id` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`active_tournament_id`) REFERENCES `tournaments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `divisions` (
	`id` text PRIMARY KEY NOT NULL,
	`sport_id` text NOT NULL,
	`name` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`sport_id`) REFERENCES `sports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `divisions_sport_name_uq` ON `divisions` (`sport_id`,`name`);--> statement-breakpoint
CREATE INDEX `divisions_sport_order_idx` ON `divisions` (`sport_id`,`display_order`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`attempt_key` text PRIMARY KEY NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`window_started_at` text NOT NULL,
	`locked_until` text
);
--> statement-breakpoint
CREATE TABLE `response_items` (
	`tournament_id` text NOT NULL,
	`school_id` text NOT NULL,
	`division_id` text NOT NULL,
	`team_count` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`tournament_id`, `school_id`, `division_id`),
	FOREIGN KEY (`tournament_id`) REFERENCES `tournaments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`division_id`) REFERENCES `divisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `response_items_division_idx` ON `response_items` (`tournament_id`,`division_id`);--> statement-breakpoint
CREATE TABLE `responses` (
	`tournament_id` text NOT NULL,
	`school_id` text NOT NULL,
	`no_participation` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`first_submitted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`tournament_id`, `school_id`),
	FOREIGN KEY (`tournament_id`) REFERENCES `tournaments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `responses_tournament_updated_idx` ON `responses` (`tournament_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `schools` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`display_order` integer NOT NULL,
	`password_salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_iterations` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schools_name_uq` ON `schools` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `schools_display_order_uq` ON `schools` (`display_order`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`actor_type` text NOT NULL,
	`school_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_actor_idx` ON `sessions` (`actor_type`,`school_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `sports` (
	`id` text PRIMARY KEY NOT NULL,
	`tournament_id` text NOT NULL,
	`name` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`team_count_enabled` integer DEFAULT false NOT NULL,
	`max_teams_per_school` integer DEFAULT 2 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tournament_id`) REFERENCES `tournaments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sports_tournament_name_uq` ON `sports` (`tournament_id`,`name`);--> statement-breakpoint
CREATE INDEX `sports_tournament_order_idx` ON `sports` (`tournament_id`,`display_order`);--> statement-breakpoint
CREATE TABLE `tournaments` (
	`id` text PRIMARY KEY NOT NULL,
	`academic_year` integer NOT NULL,
	`name` text NOT NULL,
	`survey_start` text NOT NULL,
	`survey_end` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tournaments_year_idx` ON `tournaments` (`academic_year`);