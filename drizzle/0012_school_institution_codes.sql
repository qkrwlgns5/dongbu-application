ALTER TABLE `schools` ADD `institution_fingerprint` text;--> statement-breakpoint
-- Earlier admin-added schools used a keyed fingerprint as their stable ID suffix.
-- Backfill that existing opaque value only; never rewrite IDs, school metadata, or credentials.
UPDATE schools SET institution_fingerprint = substr(id, 15)
WHERE id LIKE 'school-custom-%' AND length(id) = 57
  AND substr(id, 15) NOT GLOB '*[^A-Za-z0-9_-]*';
--> statement-breakpoint
CREATE UNIQUE INDEX `schools_institution_fingerprint_uq` ON `schools` (`institution_fingerprint`);
