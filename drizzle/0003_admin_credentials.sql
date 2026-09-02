CREATE TABLE `admin_credentials` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_algorithm` text DEFAULT 'pbkdf2-sha256-admin-v1' NOT NULL,
	`password_salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_iterations` integer NOT NULL,
	`auth_version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `admin_auth_version` integer;
