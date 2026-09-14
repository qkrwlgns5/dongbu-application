-- Existing schools, surveys, divisions, credentials, and responses stay middle-school records.
DROP INDEX `schools_display_order_uq`;--> statement-breakpoint
ALTER TABLE `schools` ADD `school_level` text DEFAULT 'middle' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `schools_level_display_order_uq` ON `schools` (`school_level`,`display_order`);--> statement-breakpoint
ALTER TABLE `divisions` ADD `school_level` text DEFAULT 'middle' NOT NULL;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `school_levels` text DEFAULT '["middle"]' NOT NULL;
--> statement-breakpoint
-- A concurrent division-level edit must never let a school save another school level's entry.
CREATE TRIGGER response_items_school_level_insert
BEFORE INSERT ON response_items
WHEN NOT EXISTS (
  SELECT 1 FROM schools sc JOIN divisions d ON d.id = NEW.division_id
  JOIN tournaments t ON t.id = NEW.tournament_id
  WHERE sc.id = NEW.school_id AND sc.school_level = d.school_level
    AND sc.school_level IN (SELECT value FROM json_each(t.school_levels))
)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_DIVISION_SCHOOL_LEVEL');
END;
--> statement-breakpoint
CREATE TRIGGER response_items_school_level_update
BEFORE UPDATE ON response_items
WHEN NOT EXISTS (
  SELECT 1 FROM schools sc JOIN divisions d ON d.id = NEW.division_id
  JOIN tournaments t ON t.id = NEW.tournament_id
  WHERE sc.id = NEW.school_id AND sc.school_level = d.school_level
    AND sc.school_level IN (SELECT value FROM json_each(t.school_levels))
)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_DIVISION_SCHOOL_LEVEL');
END;
--> statement-breakpoint
CREATE TRIGGER divisions_school_level_in_use
BEFORE UPDATE OF school_level ON divisions
WHEN NEW.school_level <> OLD.school_level AND EXISTS (SELECT 1 FROM response_items WHERE division_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'DIVISION_SCHOOL_LEVEL_IN_USE');
END;
