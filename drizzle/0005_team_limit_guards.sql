CREATE TRIGGER `sports_validate_team_limits_insert`
BEFORE INSERT ON `sports`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'INVALID_TEAM_LIMIT_CONFIGURATION')
  WHERE NEW.`max_teams_per_school` < 1
     OR NEW.`max_teams_per_school` > 20
     OR NEW.`max_teams_per_division` < 1
     OR NEW.`max_teams_per_division` > 20
     OR NEW.`max_teams_per_division` > NEW.`max_teams_per_school`;
END;
--> statement-breakpoint
CREATE TRIGGER `sports_validate_team_limits_update`
BEFORE UPDATE OF `max_teams_per_school`, `max_teams_per_division` ON `sports`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'INVALID_TEAM_LIMIT_CONFIGURATION')
  WHERE NEW.`max_teams_per_school` < 1
     OR NEW.`max_teams_per_school` > 20
     OR NEW.`max_teams_per_division` < 1
     OR NEW.`max_teams_per_division` > 20
     OR NEW.`max_teams_per_division` > NEW.`max_teams_per_school`;

  SELECT RAISE(ABORT, 'MAX_TEAMS_PER_DIVISION_IN_USE')
  WHERE EXISTS (
    SELECT 1
    FROM `response_items` ri
    JOIN `divisions` d ON d.`id` = ri.`division_id`
    WHERE d.`sport_id` = OLD.`id`
      AND ri.`team_count` > NEW.`max_teams_per_division`
  );

  SELECT RAISE(ABORT, 'MAX_TEAMS_IN_USE')
  WHERE EXISTS (
    SELECT 1
    FROM `response_items` ri
    JOIN `divisions` d ON d.`id` = ri.`division_id`
    WHERE d.`sport_id` = OLD.`id`
    GROUP BY ri.`tournament_id`, ri.`school_id`
    HAVING SUM(ri.`team_count`) > NEW.`max_teams_per_school`
  );
END;
--> statement-breakpoint
CREATE TRIGGER `response_items_validate_team_limits_insert`
BEFORE INSERT ON `response_items`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'INVALID_TEAM_COUNT')
  WHERE NEW.`team_count` < 1 OR typeof(NEW.`team_count`) <> 'integer';

  SELECT RAISE(ABORT, 'INVALID_DIVISION')
  WHERE NOT EXISTS (
    SELECT 1
    FROM `divisions` d
    JOIN `sports` s ON s.`id` = d.`sport_id`
    WHERE d.`id` = NEW.`division_id`
      AND s.`tournament_id` = NEW.`tournament_id`
  );

  SELECT RAISE(ABORT, 'DIVISION_TEAM_LIMIT_EXCEEDED')
  WHERE NEW.`team_count` > (
    SELECT s.`max_teams_per_division`
    FROM `divisions` d
    JOIN `sports` s ON s.`id` = d.`sport_id`
    WHERE d.`id` = NEW.`division_id`
      AND s.`tournament_id` = NEW.`tournament_id`
  );

  SELECT RAISE(ABORT, 'SCHOOL_TEAM_LIMIT_EXCEEDED')
  WHERE NEW.`team_count` + COALESCE((
    SELECT SUM(existing.`team_count`)
    FROM `response_items` existing
    JOIN `divisions` existing_division ON existing_division.`id` = existing.`division_id`
    WHERE existing.`tournament_id` = NEW.`tournament_id`
      AND existing.`school_id` = NEW.`school_id`
      AND existing.`division_id` <> NEW.`division_id`
      AND existing_division.`sport_id` = (
        SELECT selected_division.`sport_id`
        FROM `divisions` selected_division
        WHERE selected_division.`id` = NEW.`division_id`
      )
  ), 0) > (
    SELECT s.`max_teams_per_school`
    FROM `divisions` d
    JOIN `sports` s ON s.`id` = d.`sport_id`
    WHERE d.`id` = NEW.`division_id`
      AND s.`tournament_id` = NEW.`tournament_id`
  );
END;
--> statement-breakpoint
CREATE TRIGGER `response_items_validate_team_limits_update`
BEFORE UPDATE OF `tournament_id`, `school_id`, `division_id`, `team_count` ON `response_items`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'INVALID_TEAM_COUNT')
  WHERE NEW.`team_count` < 1 OR typeof(NEW.`team_count`) <> 'integer';

  SELECT RAISE(ABORT, 'INVALID_DIVISION')
  WHERE NOT EXISTS (
    SELECT 1
    FROM `divisions` d
    JOIN `sports` s ON s.`id` = d.`sport_id`
    WHERE d.`id` = NEW.`division_id`
      AND s.`tournament_id` = NEW.`tournament_id`
  );

  SELECT RAISE(ABORT, 'DIVISION_TEAM_LIMIT_EXCEEDED')
  WHERE NEW.`team_count` > (
    SELECT s.`max_teams_per_division`
    FROM `divisions` d
    JOIN `sports` s ON s.`id` = d.`sport_id`
    WHERE d.`id` = NEW.`division_id`
      AND s.`tournament_id` = NEW.`tournament_id`
  );

  SELECT RAISE(ABORT, 'SCHOOL_TEAM_LIMIT_EXCEEDED')
  WHERE NEW.`team_count` + COALESCE((
    SELECT SUM(existing.`team_count`)
    FROM `response_items` existing
    JOIN `divisions` existing_division ON existing_division.`id` = existing.`division_id`
    WHERE existing_division.`sport_id` = (
        SELECT selected_division.`sport_id`
        FROM `divisions` selected_division
        WHERE selected_division.`id` = NEW.`division_id`
      )
      AND existing.`tournament_id` = NEW.`tournament_id`
      AND existing.`school_id` = NEW.`school_id`
      AND NOT (
        existing.`tournament_id` = OLD.`tournament_id`
        AND existing.`school_id` = OLD.`school_id`
        AND existing.`division_id` = OLD.`division_id`
      )
  ), 0) > (
    SELECT s.`max_teams_per_school`
    FROM `divisions` d
    JOIN `sports` s ON s.`id` = d.`sport_id`
    WHERE d.`id` = NEW.`division_id`
      AND s.`tournament_id` = NEW.`tournament_id`
  );
END;
--> statement-breakpoint
PRAGMA optimize;
