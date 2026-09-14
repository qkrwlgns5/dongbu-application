-- Existing school eligibility remains unbounded; only new admin-added schools receive a start timestamp.
ALTER TABLE `schools` ADD `eligible_from` text;
--> statement-breakpoint
-- School save starts with a response upsert. Guard it inside the atomic batch,
-- including empty/non-participation responses, if publication or dates changed concurrently.
CREATE TRIGGER responses_writable_insert
BEFORE INSERT ON responses
WHEN NOT EXISTS (
  SELECT 1 FROM tournaments t JOIN schools sc ON sc.id = NEW.school_id
  WHERE t.id = NEW.tournament_id AND t.status = 'active' AND sc.active = 1
    AND julianday(t.survey_start) <= julianday('now') AND julianday(t.survey_end) > julianday('now')
    AND sc.school_level IN (SELECT value FROM json_each(t.school_levels))
    AND (sc.eligible_from IS NULL OR julianday(sc.eligible_from) < julianday(t.survey_end))
)
BEGIN
  SELECT RAISE(ABORT, 'SURVEY_NOT_WRITABLE');
END;
--> statement-breakpoint
CREATE TRIGGER responses_writable_update
BEFORE UPDATE ON responses
WHEN NOT EXISTS (
  SELECT 1 FROM tournaments t JOIN schools sc ON sc.id = NEW.school_id
  WHERE t.id = NEW.tournament_id AND t.status = 'active' AND sc.active = 1
    AND julianday(t.survey_start) <= julianday('now') AND julianday(t.survey_end) > julianday('now')
    AND sc.school_level IN (SELECT value FROM json_each(t.school_levels))
    AND (sc.eligible_from IS NULL OR julianday(sc.eligible_from) < julianday(t.survey_end))
)
BEGIN
  SELECT RAISE(ABORT, 'SURVEY_NOT_WRITABLE');
END;
