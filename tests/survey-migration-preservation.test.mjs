import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const drizzle = new URL("../drizzle/", import.meta.url);
const legacyEventId = "event-2026-second-half-application";
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const plainRows = (statement, ...values) => statement.all(...values).map((row) => ({ ...row }));

async function apply(sqlite, names) {
  for (const name of names) sqlite.exec(await readFile(new URL(name, drizzle), "utf8"));
}

function snapshot(sqlite) {
  const tables = plainRows(sqlite.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"));
  return Object.fromEntries(tables.map(({ name }) => {
    const columns = plainRows(sqlite.prepare(`PRAGMA table_info(${quote(name)})`));
    const fields = columns.map((column) => quote(column.name)).join(",");
    return [name, { columns, rows: plainRows(sqlite.prepare(`SELECT ${fields} FROM ${quote(name)} ORDER BY ${fields}`)) }];
  }));
}

test("application feature migrations preserve the entire 0000–0008 schema data, identity, branding, and team limits", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec("PRAGMA foreign_keys = ON");
    const migrations = (await readdir(drizzle)).filter((name) => name.endsWith(".sql")).sort();
    const legacyMigrations = migrations.filter((name) => name < "0009");
    assert.deepEqual(legacyMigrations, [
      "0000_swift_marvex.sql", "0001_supreme_punisher.sql", "0002_seed_initial_survey.sql",
      "0003_admin_credentials.sql", "0004_new_moon_knight.sql", "0005_team_limit_guards.sql",
      "0006_event_card_copy.sql", "0007_page_header_copy.sql", "0008_logo_image.sql",
    ]);
    await apply(sqlite, legacyMigrations);
    assert.deepEqual(plainRows(sqlite.prepare("SELECT id FROM tournaments")), [{ id: legacyEventId }]);
    assert.equal(sqlite.prepare("SELECT active_tournament_id FROM app_config WHERE id = 1").get().active_tournament_id, legacyEventId);

    // The application intentionally changed its 3x3 limit in its own 0004.
    // New features must preserve that history, not replay the form's 0004.
    assert.deepEqual({ ...sqlite.prepare("SELECT team_count_enabled, max_teams_per_school, max_teams_per_division FROM sports WHERE id = 'sport-basketball-3x3'").get() }, {
      team_count_enabled: 0, max_teams_per_school: 2, max_teams_per_division: 1,
    });

    // Only in-memory, invented records are added. Existing seed dates and IDs
    // remain untouched, including the ended application's saved results.
    sqlite.prepare("UPDATE tournaments SET card_copy = ?, header_copy = ?, logo_key = ? WHERE id = ?")
      .run('{"title":"보존 확인 대회"}', '{"titleSecondary":"기존 참가 신청"}', "fake-existing-logo-key", legacyEventId);
    sqlite.exec(`
      INSERT INTO responses
        (tournament_id, school_id, no_participation, revision, first_submitted_at, updated_at)
      VALUES
        ('event-2026-second-half-application', 'school-001', 0, 5, '2026-08-25T01:02:03.000Z', '2026-08-26T04:05:06.000Z'),
        ('event-2026-second-half-application', 'school-002', 1, 3, '2026-08-27T01:02:03.000Z', '2026-08-28T04:05:06.000Z');
      INSERT INTO response_items (tournament_id, school_id, division_id, team_count)
      VALUES
        ('event-2026-second-half-application', 'school-001', 'division-basketball-male', 1),
        ('event-2026-second-half-application', 'school-001', 'division-basketball-female', 1);
      INSERT INTO admin_credentials
        (id, username, password_algorithm, password_salt, password_hash, password_iterations, auth_version, created_at, updated_at)
      VALUES
        (1, 'fake-migration-admin', 'pbkdf2-sha256-admin-v1', 'fake-admin-salt', 'fake-admin-hash', 100000, 7, '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z');
      INSERT INTO sessions
        (token_hash, actor_type, school_id, tournament_id, admin_auth_version, created_at, expires_at)
      VALUES
        ('fake-admin-session-token-hash', 'admin', NULL, NULL, 7, '2026-08-08T00:00:00.000Z', '2099-01-01T00:00:00.000Z'),
        ('fake-school-session-token-hash', 'school', 'school-001', 'event-2026-second-half-application', NULL, '2026-08-09T00:00:00.000Z', '2099-01-02T00:00:00.000Z');
      INSERT INTO login_attempts (attempt_key, failure_count, window_started_at, locked_until)
      VALUES ('fake-login-attempt', 2, '2026-08-09T00:00:00.000Z', NULL);
      INSERT INTO admin_audit_logs (id, action, entity_type, entity_id, detail, created_at)
      VALUES ('fake-old-audit', 'UPDATE', 'tournament', 'event-2026-second-half-application', '{"testOnly":true}', '2026-08-10T00:00:00.000Z');
    `);
    const before = snapshot(sqlite);
    const oldSchemaObjects = plainRows(sqlite.prepare("SELECT type, name, sql FROM sqlite_schema WHERE type IN ('index', 'trigger') AND name NOT LIKE 'sqlite_%' AND name <> 'schools_display_order_uq' ORDER BY name"));
    const newMigrations = migrations.filter((name) => name >= "0009");
    assert.deepEqual(newMigrations, [
      "0009_school_level_applications.sql", "0010_elementary_schools.sql",
      "0011_school_management.sql", "0012_school_institution_codes.sql",
    ]);
    await apply(sqlite, newMigrations);

    for (const [table, previous] of Object.entries(before)) {
      const columns = plainRows(sqlite.prepare(`PRAGMA table_info(${quote(table)})`));
      assert.deepEqual(columns.slice(0, previous.columns.length), previous.columns, `${table}: every existing column definition is preserved`);
      const fields = previous.columns.map((column) => quote(column.name)).join(",");
      const originalSchoolIds = before.schools.rows.map((row) => row.id);
      const where = table === "schools" ? ` WHERE id IN (${originalSchoolIds.map(() => "?").join(",")})` : "";
      const after = plainRows(sqlite.prepare(`SELECT ${fields} FROM ${quote(table)}${where} ORDER BY ${fields}`), ...(table === "schools" ? originalSchoolIds : []));
      assert.deepEqual(after, previous.rows, `${table}: every saved value remains unchanged`);
    }
    for (const item of oldSchemaObjects) {
      assert.deepEqual({ ...sqlite.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name = ?").get(item.name) }, item, `${item.name}: existing guard/index remains unchanged`);
    }
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM schools WHERE school_level = 'middle' AND eligible_from IS NULL AND institution_fingerprint IS NULL").get().n, 42);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM schools WHERE school_level = 'elementary'").get().n, 73);
    assert.equal(sqlite.prepare("SELECT school_levels FROM tournaments WHERE id = ?").get(legacyEventId).school_levels, '["middle"]');
    assert.deepEqual(plainRows(sqlite.prepare("SELECT DISTINCT school_level FROM divisions")), [{ school_level: "middle" }]);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM responses").get().n, 2);
    assert.equal(sqlite.prepare("SELECT SUM(team_count) AS n FROM response_items").get().n, 2);
    assert.deepEqual(plainRows(sqlite.prepare("PRAGMA foreign_key_check")), []);
    assert.equal(sqlite.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  } finally {
    sqlite.close();
  }
});
