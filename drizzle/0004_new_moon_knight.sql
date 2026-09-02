ALTER TABLE `sports` ADD `max_teams_per_division` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
UPDATE `sports`
SET `max_teams_per_division` = `max_teams_per_school`
WHERE `team_count_enabled` = 1;
--> statement-breakpoint
UPDATE `sports`
SET `max_teams_per_division` = 1,
    `team_count_enabled` = 0
WHERE `name` = '3x3 농구';
--> statement-breakpoint
PRAGMA optimize;
