import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { normalizeSchoolPasswordInput } from "../worker/school-password.js";

// Exercise the real API using isolated, throwaway SQLite and invented codes only.
const root = new URL("../", import.meta.url);
let source = await readFile(new URL("worker/api.ts", root), "utf8");
for (const path of ["school-password", "team-limits", "logo-image"]) source = source.replace(JSON.stringify(`./${path}.js`), JSON.stringify(new URL(`worker/${path}.js`, root).href));
for (const path of ["event-card-copy", "page-header-copy", "school-levels"]) source = source.replace(JSON.stringify(`../app/${path}.js`), JSON.stringify(new URL(`app/${path}.js`, root).href));
const { handleApi } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);

class TestD1 {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) {
    const statement = this.sqlite.prepare(sql);
    const wrap = (values = []) => ({
      bind: (...next) => wrap(next),
      first: async (column) => { const row = statement.get(...values); return column ? row?.[column] ?? null : row ? { ...row } : null; },
      all: async () => ({ success: true, results: statement.all(...values).map((row) => ({ ...row })) }),
      run: async () => { const result = statement.run(...values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; },
    });
    return wrap();
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const [index, statement] of statements.entries()) {
        results.push(await statement.run());
        if (this.failNextBatch && index === 1) { this.failNextBatch = false; throw new Error("Simulated D1 failure after two writes"); }
      }
      this.sqlite.exec("COMMIT"); return results;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

const migrations = (await readdir(new URL("drizzle/", root))).filter((file) => file.endsWith(".sql")).sort();
async function apply(sqlite, names = migrations) {
  for (const name of names) sqlite.exec(await readFile(new URL(`drizzle/${name}`, root), "utf8"));
}

async function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  await apply(sqlite);
  const env = { DB: new TestD1(sqlite), ADMIN_USERNAME: "isolated-admin", ADMIN_PASSWORD: randomBytes(16).toString("hex"), SCHOOL_PASSWORD_PEPPER: randomBytes(24).toString("hex") };
  const start = new Date(Date.now() - 86_400_000).toISOString();
  const end = new Date(Date.now() + 86_400_000).toISOString();
  sqlite.prepare("UPDATE tournaments SET survey_start = ?, survey_end = ?").run(start, end);
  for (const [id, name, level, order, code] of [["test-middle", "검증중학교", "middle", 99, "동다99"], ["test-elementary", "검증초등학교", "elementary", 99, "동나99"], ["test-elementary-b", "별빛검증초등학교", "elementary", 98, "동너99"]]) {
    const salt = randomBytes(16);
    const hash = pbkdf2Sync(code + env.SCHOOL_PASSWORD_PEPPER, salt, 1000, 32, "sha256").toString("base64url");
    sqlite.prepare("INSERT INTO schools (id,name,school_level,display_order,password_salt,password_hash,password_iterations) VALUES (?,?,?,?,?,?,?)").run(id, name, level, order, salt.toString("base64url"), hash, 1000);
  }
  async function call(path, { method = "GET", body, cookie } = {}) {
    const response = await handleApi(new Request(`https://isolated.example/api/${path}`, { method, headers: { "Content-Type": "application/json", Origin: "https://isolated.example", ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
    return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  const admin = await call("admin/login", { method: "POST", body: { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD } });
  assert.equal(admin.status, 200);
  const cookie = admin.cookie;
  const payload = { academicYear: 2027, name: "다음 학년도 검증 참가 신청", surveyStart: start, surveyEnd: end };
  const create = async (levels) => call("admin/events", { method: "POST", cookie, body: { ...payload, ...(levels === undefined ? {} : { schoolLevels: levels }) } });
  const activate = async (id) => { const result = await call(`admin/events/${id}/activate`, { method: "POST", cookie, body: {} }); assert.equal(result.status, 200); };
  const dashboard = async (id) => (await call(`admin/dashboard?eventId=${id}`, { cookie })).data;
  const login = async (id, password) => call("school/login", { method: "POST", body: { schoolId: id, password } });
  return { sqlite, env, call, cookie, create, activate, dashboard, login, payload };
}

test("school-level migrations preserve every preexisting column, credential, response, and old denominator", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec("PRAGMA foreign_keys = ON");
    await apply(sqlite, migrations.filter((name) => name < "0009"));
    const tournament = sqlite.prepare("SELECT id FROM tournaments LIMIT 1").get().id;
    const school = sqlite.prepare("SELECT id FROM schools ORDER BY display_order LIMIT 1").get().id;
    const division = sqlite.prepare("SELECT id FROM divisions ORDER BY display_order LIMIT 1").get().id;
    sqlite.prepare("INSERT INTO responses (tournament_id, school_id, revision) VALUES (?, ?, 3)").run(tournament, school);
    sqlite.prepare("INSERT INTO response_items (tournament_id, school_id, division_id, team_count) VALUES (?, ?, ?, 1)").run(tournament, school, division);
    sqlite.prepare("INSERT INTO admin_credentials (id, username, password_salt, password_hash, password_iterations, auth_version) VALUES (1, 'legacy-isolated-admin', 'isolated-salt', 'isolated-hash', 1000, 3)").run();
    sqlite.prepare("INSERT INTO sessions (token_hash, actor_type, school_id, tournament_id, expires_at) VALUES ('isolated-school-session', 'school', ?, ?, '2099-01-01T00:00:00.000Z')").run(school, tournament);
    sqlite.prepare("INSERT INTO sessions (token_hash, actor_type, admin_auth_version, expires_at) VALUES ('isolated-admin-session', 'admin', 3, '2099-01-01T00:00:00.000Z')").run();
    sqlite.prepare("INSERT INTO admin_audit_logs (id, action, entity_type, entity_id, detail) VALUES ('isolated-audit', 'UPDATE', 'tournament', ?, '{}')").run(tournament);
    const tables = ["schools", "tournaments", "sports", "divisions", "responses", "response_items", "sessions", "admin_credentials", "app_config", "admin_audit_logs"];
    const before = Object.fromEntries(tables.map((name) => [name, sqlite.prepare(`SELECT * FROM ${name}`).all().map((row) => ({ ...row }))]));
    await apply(sqlite, migrations.filter((name) => name >= "0009"));
    for (const table of tables) {
      if (!before[table].length) { assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0); continue; }
      const fields = Object.keys(before[table][0]).join(",");
      const after = sqlite.prepare(`SELECT ${fields} FROM ${table}${table === "schools" ? " WHERE school_level = 'middle'" : ""}`).all().map((row) => ({ ...row }));
      assert.deepEqual(after, before[table], `${table} must retain every legacy value`);
    }
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM schools WHERE school_level = 'middle'").get().n, 42);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM schools WHERE school_level = 'elementary'").get().n, 73);
    assert.equal(sqlite.prepare("SELECT school_levels FROM tournaments WHERE id = ?").get(tournament).school_levels, '["middle"]');
    assert.equal(sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { sqlite.close(); }
});

test("new surveys validate school levels, retain prior survey, initialize matching divisions, and create atomically", async () => {
  const f = await fixture();
  try {
    const active = (await f.call("bootstrap")).data.tournament;
    assert.equal((await f.call("admin/events", { method: "POST", body: f.payload })).status, 401);
    for (const value of [[], null, "elementary", ["high"], ["elementary", "invalid"]]) {
      const result = await f.create(value);
      assert.equal(result.status, 400);
      assert.equal(result.data.code, "INVALID_SCHOOL_LEVELS");
    }
    for (const levels of [["elementary"], ["middle"], ["elementary", "middle"], undefined]) {
      const created = await f.create(levels);
      assert.equal(created.status, 201);
      const data = await f.dashboard(created.data.id);
      assert.deepEqual(JSON.parse(data.selectedEvent.schoolLevels), levels ?? ["middle"]);
      assert.equal(data.selectedEvent.status, "draft");
      const wanted = levels?.includes("elementary") ? levels.includes("middle") ? ["남초부", "여초부", "남중부", "여중부"] : ["남초부", "여초부"] : ["남중부", "여중부"];
      assert.equal(data.sports.length, 3);
      for (const sport of data.sports) assert.deepEqual(sport.divisions.map((division) => division.name), wanted);
      assert.deepEqual((await f.call("bootstrap")).data.tournament, active);
    }
    const before = ["tournaments", "sports", "divisions", "admin_audit_logs"].map((name) => f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n);
    f.env.DB.failNextBatch = true;
    assert.equal((await f.create(["elementary"])).status, 500);
    assert.deepEqual(["tournaments", "sports", "divisions", "admin_audit_logs"].map((name) => f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n), before);
  } finally { f.sqlite.close(); }
});

test("school lists, sessions, results and participant summaries stay scoped to eligible school levels", async () => {
  const f = await fixture();
  try {
    const initial = (await f.call("bootstrap")).data;
    assert.equal(initial.schools.length, 43);
    assert.ok(initial.schools.every((school) => school.schoolLevel === "middle"));
    assert.equal((await f.login("test-elementary", "ehdsk99")).status, 401);
    const middleBefore = await f.login("test-middle", "ehdek99");
    assert.equal(middleBefore.status, 200);
    const created = await f.create(["middle", "elementary"]);
    await f.activate(created.data.id);
    const both = (await f.call("bootstrap")).data;
    assert.deepEqual(JSON.parse(both.tournament.schoolLevels), ["elementary", "middle"]);
    assert.equal(both.schools.length, 118);
    assert.equal(both.schools[0].schoolLevel, "elementary");
    assert.equal(both.schools.at(-1).schoolLevel, "middle");
    const previousSession = await f.call(`school/session?tournamentId=${initial.tournament.id}&schoolId=${middleBefore.data.school.id}`, { cookie: middleBefore.cookie });
    assert.equal(previousSession.status, 200, "publishing a second survey keeps the first survey session valid");
    assert.equal(previousSession.data.tournament.id, initial.tournament.id);
    const elementary = await f.login("test-elementary", "EHDSK99");
    const middle = await f.login("test-middle", "동다99");
    assert.equal(elementary.status, 200); assert.equal(middle.status, 200);
    assert.equal((await f.login("test-elementary-b", "EHDSJ99")).status, 200);
    for (const [session, level] of [[elementary, "elementary"], [middle, "middle"]]) {
      assert.equal(session.data.school.schoolLevel, level);
      assert.ok(session.data.sports.every((sport) => sport.divisions.length === 2 && sport.divisions.every((division) => division.schoolLevel === level)));
      assert.deepEqual((await f.call("school/session", { cookie: session.cookie })).data.sports, session.data.sports);
    }
    const elementaryDivision = elementary.data.sports[0].divisions[0].id;
    const middleDivision = middle.data.sports[0].divisions[0].id;
    const save = (session, divisionId) => f.call("school/survey", { method: "PUT", cookie: session.cookie, body: { tournamentId: session.data.tournament.id, schoolId: session.data.school.id, revision: 0, selections: [{ divisionId, teamCount: 1 }] } });
    assert.equal((await save(elementary, middleDivision)).status, 400);
    assert.equal((await save(middle, elementaryDivision)).status, 400);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM responses").get().n, 0);
    assert.equal((await save(elementary, elementaryDivision)).status, 200);
    assert.equal((await save(middle, middleDivision)).status, 200);
    const dashboard = await f.dashboard(created.data.id);
    assert.equal(dashboard.rows.length, 118);
    assert.equal(dashboard.rows.filter((row) => row.submitted).length, 2);
    const participants = (await f.call("school/participants", { cookie: elementary.cookie })).data;
    const selectedSport = participants.sports.find((sport) => sport.id === elementary.data.sports[0].id);
    assert.equal(selectedSport.schoolCount, 2);
    assert.equal(selectedSport.teamCount, 2);
    assert.deepEqual(selectedSport.schools.map((school) => school.schoolLevel), ["elementary", "middle"]);
    assert.equal(selectedSport.schools.filter((school) => school.isOwnSchool).length, 1);
    assert.ok(selectedSport.divisions.every((division) => ["elementary", "middle"].includes(division.schoolLevel)));
    await f.activate(initial.tournament.id);
    assert.equal((await f.call("bootstrap")).data.schools.length, 43);
    assert.equal((await f.dashboard(initial.tournament.id)).rows.length, 43);
    assert.equal((await f.dashboard(initial.tournament.id)).rows.filter((row) => row.submitted).length, 0);
    assert.equal((await f.dashboard(created.data.id)).rows.filter((row) => row.submitted).length, 2);
    assert.equal((await f.call(`school/session?tournamentId=${created.data.id}&schoolId=${elementary.data.school.id}`, { cookie: elementary.cookie })).status, 200);
    assert.equal((await f.call(`admin/events/${created.data.id}/unpublish`, { method: "POST", cookie: f.cookie, body: {} })).status, 200);
    assert.equal((await f.call("school/session", { cookie: elementary.cookie })).data.code, "SURVEY_CLOSED");
    assert.equal((await f.call("school/survey", { method: "PUT", cookie: elementary.cookie, body: { tournamentId: created.data.id, schoolId: elementary.data.school.id, revision: 1, noParticipation: true } })).data.code, "SURVEY_CLOSED");
    assert.equal((await f.dashboard(created.data.id)).rows.filter((row) => row.submitted).length, 2, "unpublishing preserves submitted responses");
  } finally { f.sqlite.close(); }
});

test("elementary-only surveys reject middle login and revalidate forged or stale school sessions", async () => {
  const f = await fixture();
  try {
    const middle = await f.login("test-middle", "ehdek99");
    const created = await f.create(["elementary"]);
    await f.activate(created.data.id);
    const bootstrap = (await f.call("bootstrap")).data;
    assert.equal(bootstrap.schools.length, 75);
    assert.ok(bootstrap.schools.every((school) => school.schoolLevel === "elementary"));
    assert.equal((await f.login("test-middle", "ehdek99")).status, 401);
    f.sqlite.prepare("UPDATE sessions SET tournament_id = ? WHERE school_id = 'test-middle'").run(created.data.id);
    for (const [path, method, body] of [["school/session", "GET"], ["school/participants", "GET"], ["school/survey", "PUT", { tournamentId: created.data.id, schoolId: middle.data.school.id, revision: 0, noParticipation: true }]]) {
      const result = await f.call(path, { method, body, cookie: middle.cookie });
      assert.equal(result.status, 403);
      assert.equal(result.data.code, "SCHOOL_NOT_ELIGIBLE");
    }
    const elementary = await f.login("test-elementary", "동나99");
    assert.equal(elementary.status, 200);
    f.sqlite.prepare("UPDATE schools SET active = 0 WHERE id = 'test-elementary'").run();
    assert.equal((await f.call("school/survey", { method: "PUT", cookie: elementary.cookie, body: { tournamentId: elementary.data.tournament.id, schoolId: elementary.data.school.id, revision: 0, noParticipation: true } })).data.code, "SCHOOL_INACTIVE");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM responses").get().n, 0);
  } finally { f.sqlite.close(); }
});

test("existing survey targets are immutable and sport division edits validate levels and preserve submitted responses", async () => {
  const f = await fixture();
  try {
    const old = (await f.call("bootstrap")).data.tournament;
    const updateEvent = (id, levels) => f.call(`admin/events/${id}`, { method: "PATCH", cookie: f.cookie, body: { ...f.payload, ...(levels === undefined ? {} : { schoolLevels: levels }) } });
    assert.equal((await updateEvent(old.id, ["elementary", "middle"])).data.code, "SCHOOL_LEVELS_IMMUTABLE");
    assert.equal((await updateEvent(old.id, [])).status, 400);
    assert.equal((await updateEvent(old.id, ["middle"])).status, 200);
    assert.equal((await updateEvent(old.id, undefined)).status, 200);
    assert.equal((await f.call("bootstrap")).data.tournament.schoolLevels, '["middle"]');
    const created = await f.create(["elementary", "middle"]);
    await f.activate(created.data.id);
    const addSport = (name, divisions, eventId = created.data.id) => f.call("admin/sports", { method: "POST", cookie: f.cookie, body: { eventId, name, divisions, maxTeamsPerSchool: 2, maxTeamsPerDivision: 1 } });
    assert.equal((await addSport("검증 축구", ["남초부", "여초부"])).status, 400);
    assert.equal((await addSport("검증 축구", [{ name: "남고부", schoolLevel: "high" }])).status, 400);
    assert.equal((await addSport("검증 축구", [{ name: "남초부", schoolLevel: "elementary" }], old.id)).status, 400);
    assert.equal((await addSport("기존 호환", ["남중부", "여중부"], old.id)).status, 201);
    const added = await addSport("검증 축구", [{ name: "남초부", schoolLevel: "elementary" }, { name: "남중부", schoolLevel: "middle" }]);
    assert.equal(added.status, 201);
    let sport = (await f.dashboard(created.data.id)).sports.find((item) => item.id === added.data.id);
    const updateSport = (divisions) => f.call(`admin/sports/${sport.id}`, { method: "PATCH", cookie: f.cookie, body: { name: sport.name, maxTeamsPerSchool: 2, maxTeamsPerDivision: 1, divisions } });
    assert.equal((await updateSport(sport.divisions.map(({ id, name }) => ({ id, name })))).status, 200, "omitted level must preserve each existing division");
    assert.equal((await updateSport([...sport.divisions, { name: "혼합부" }])).status, 400);
    assert.equal((await updateSport([...sport.divisions, { name: "여초부", schoolLevel: "elementary" }])).status, 200);
    sport = (await f.dashboard(created.data.id)).sports.find((item) => item.id === added.data.id);
    const elementary = await f.login("test-elementary", "ehdsk99");
    const divisionId = sport.divisions[0].id;
    assert.equal((await f.call("school/survey", { method: "PUT", cookie: elementary.cookie, body: { tournamentId: elementary.data.tournament.id, schoolId: elementary.data.school.id, revision: 0, selections: [{ divisionId, teamCount: 1 }] } })).status, 200);
    const changed = sport.divisions.map((division) => division.id === divisionId ? { ...division, schoolLevel: "middle" } : division);
    assert.equal((await updateSport(changed)).data.code, "DIVISION_SCHOOL_LEVEL_IN_USE");
    assert.throws(() => f.sqlite.prepare("UPDATE divisions SET school_level = 'middle' WHERE id = ?").run(divisionId), /DIVISION_SCHOOL_LEVEL_IN_USE/);
    const middleDivision = sport.divisions.find((division) => division.schoolLevel === "middle").id;
    assert.throws(() => f.sqlite.prepare("INSERT INTO response_items (tournament_id, school_id, division_id, team_count) VALUES (?, 'test-elementary', ?, 1)").run(created.data.id, middleDivision), /INVALID_DIVISION_SCHOOL_LEVEL/);
    assert.throws(() => f.sqlite.prepare("UPDATE response_items SET division_id = ? WHERE tournament_id = ? AND school_id = 'test-elementary'").run(middleDivision, created.data.id), /INVALID_DIVISION_SCHOOL_LEVEL/);
    assert.equal((await f.call("school/session", { cookie: elementary.cookie })).data.survey.selections[0].divisionId, divisionId);
    assert.equal(f.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { f.sqlite.close(); }
});

test("institution code normalization accepts exact Korean and English keyboard prefixes only", () => {
  for (const [english, korean] of [["ehdsk99", "동나99"], ["ehdsj99", "동너99"], ["ehdek99", "동다99"], ["ehdej99", "동더99"]]) {
    assert.equal(normalizeSchoolPasswordInput(english), korean);
    assert.equal(normalizeSchoolPasswordInput(` ${english.toUpperCase()} `), korean);
    assert.equal(normalizeSchoolPasswordInput(korean), korean);
    assert.equal(normalizeSchoolPasswordInput(korean.normalize("NFD")), korean);
  }
  assert.equal(normalizeSchoolPasswordInput("ehdsk999"), "동나999");
  assert.equal(normalizeSchoolPasswordInput("EHDEK9999"), "동다9999");
  for (const unchanged of ["ehdsk9", "ehdsk99999", "ehdsk 99", "ehdsk99suffix", "prefixehdsk99", "ehsk99", "ehsj99", "other99"]) assert.equal(normalizeSchoolPasswordInput(unchanged), unchanged);
});
