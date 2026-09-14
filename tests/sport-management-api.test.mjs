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
for (const path of ["event-card-copy", "page-header-copy", "school-levels", "sport-icons"]) source = source.replace(JSON.stringify(`../app/${path}.js`), JSON.stringify(new URL(`app/${path}.js`, root).href));
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

const sportRequest = (eventId, overrides = {}) => ({
  eventId, name: "아이콘 검증 배구", divisions: [{ name: "남중부", schoolLevel: "middle" }, { name: "여중부", schoolLevel: "middle" }],
  maxTeamsPerSchool: 2, maxTeamsPerDivision: 1, ...overrides,
});
const addSport = (f, eventId, overrides = {}, cookie = f.cookie) => f.call("admin/sports", { method: "POST", cookie, body: sportRequest(eventId, overrides) });
const updateSport = (f, sport, overrides = {}, cookie = f.cookie) => f.call(`admin/sports/${sport.id}`, { method: "PATCH", cookie, body: { name: sport.name, maxTeamsPerSchool: sport.maxTeamsPerSchool, maxTeamsPerDivision: sport.maxTeamsPerDivision, divisions: sport.divisions, ...overrides } });
const snapshot = (sqlite, table) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all().map((row) => ({ ...row }));

test("new events start empty for each school-level combination while existing settings and submitted data are untouched", async () => {
  const f = await fixture();
  try {
    const beforeBootstrap = (await f.call("bootstrap")).data;
    const session = await f.login("test-middle", "ehdek99");
    assert.equal(session.status, 200);
    assert.equal((await f.call("school/survey", { method: "PUT", cookie: session.cookie, body: { tournamentId: session.data.tournament.id, schoolId: session.data.school.id, revision: 0, selections: [{ divisionId: session.data.sports[0].divisions[0].id, teamCount: 1 }] } })).status, 200);
    const tables = ["schools", "sports", "divisions", "responses", "response_items", "sessions", "admin_credentials", "app_config"];
    const before = Object.fromEntries(tables.map((table) => [table, snapshot(f.sqlite, table)]));
    const previousTournament = { ...f.sqlite.prepare("SELECT * FROM tournaments WHERE id = ?").get(beforeBootstrap.tournament.id) };
    for (const levels of [["elementary"], ["middle"], ["elementary", "middle"], undefined]) {
      const created = await f.create(levels);
      assert.equal(created.status, 201);
      const dashboard = await f.dashboard(created.data.id);
      assert.equal(dashboard.selectedEvent.status, "draft");
      assert.deepEqual(JSON.parse(dashboard.selectedEvent.schoolLevels), levels ?? ["middle"]);
      assert.deepEqual(dashboard.sports, []);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sports WHERE tournament_id = ?").get(created.data.id).n, 0);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM divisions d JOIN sports s ON s.id = d.sport_id WHERE s.tournament_id = ?").get(created.data.id).n, 0);
      assert.deepEqual((await f.call("bootstrap")).data, beforeBootstrap);
    }
    for (const table of tables) assert.deepEqual(snapshot(f.sqlite, table), before[table], table + " must not change on new-event creation");
    assert.deepEqual({ ...f.sqlite.prepare("SELECT * FROM tournaments WHERE id = ?").get(beforeBootstrap.tournament.id) }, previousTournament);
    const configured = await f.create(["elementary"]);
    const added = await addSport(f, configured.data.id, { name: "직접 추가 넷볼", iconKey: "netball", divisions: [{ name: "여초부", schoolLevel: "elementary" }] });
    assert.equal(added.status, 201);
    assert.equal((await f.dashboard(configured.data.id)).sports.length, 1);
    assert.equal(f.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { f.sqlite.close(); }
});

test("administrators choose sport icons, all readers return stored keys, omitted edits preserve them, and other events remain isolated", async () => {
  const f = await fixture();
  try {
    const oldId = (await f.call("bootstrap")).data.tournament.id;
    const oldSports = (await f.dashboard(oldId)).sports;
    assert.ok(oldSports.every((sport) => sport.iconKey === "auto"));
    const createdId = (await f.create(["middle"])).data.id;
    const added = await addSport(f, createdId);
    assert.equal(added.status, 201);
    let sport = (await f.dashboard(createdId)).sports[0];
    assert.equal(sport.iconKey, "auto");
    const choices = ["auto", "generic", "basketball-3x3", "netball", "basketball", "volleyball", "badminton", "sport-stacking", "baseball", "athletics", "jokgu", "jump-rope", "football", "cheerleading", "kinball", "table-tennis", "teeball", "futsal", "flying-disc", "floorball", "dodgeball"];
    for (const iconKey of choices) {
      assert.equal((await updateSport(f, sport, { iconKey })).status, 200, iconKey);
      sport = (await f.dashboard(createdId)).sports[0];
      assert.equal(sport.iconKey, iconKey);
    }
    assert.equal((await updateSport(f, sport, { iconKey: "netball" })).status, 200);
    assert.equal((await updateSport(f, sport, { name: "이름만 수정한 종목" })).status, 200);
    sport = (await f.dashboard(createdId)).sports[0];
    assert.equal(sport.iconKey, "netball", "omitting iconKey on update must preserve the current stored choice");
    assert.equal((await addSport(f, createdId, { name: "직접 추가 피구", iconKey: "dodgeball" })).status, 201);
    await f.activate(createdId);
    const bootstrap = (await f.call(`bootstrap?tournamentId=${createdId}`)).data;
    assert.equal(bootstrap.sports.find((item) => item.id === sport.id).iconKey, "netball");
    const session = await f.call("school/login", { method: "POST", body: { tournamentId: createdId, schoolId: "test-middle", password: "ehdek99" } });
    assert.equal(session.status, 200);
    assert.equal(session.data.sports.find((item) => item.id === sport.id).iconKey, "netball");
    const participants = await f.call(`school/participants?tournamentId=${createdId}&schoolId=test-middle`, { cookie: session.cookie });
    assert.equal(participants.status, 200);
    assert.equal(participants.data.sports.find((item) => item.id === sport.id).iconKey, "netball");
    assert.deepEqual((await f.dashboard(oldId)).sports, oldSports);
  } finally { f.sqlite.close(); }
});

test("sport-icon writes are admin-only and malformed or remote icon keys fail without changing saved data", async () => {
  const f = await fixture();
  try {
    const activeId = (await f.call("bootstrap")).data.tournament.id;
    const session = await f.login("test-middle", "ehdek99");
    const sport = (await f.dashboard(activeId)).sports[0];
    for (const cookie of [undefined, session.cookie, "dongbu_admin_session=invalid"]) {
      const anonymousAdd = await f.call("admin/sports", { method: "POST", cookie, body: sportRequest(activeId, { name: "비인가 종목", iconKey: "netball" }) });
      assert.equal(anonymousAdd.status, 401);
      const anonymousUpdate = await f.call(`admin/sports/${sport.id}`, { method: "PATCH", cookie, body: { ...sport, iconKey: "netball" } });
      assert.equal(anonymousUpdate.status, 401);
    }
    const beforeSports = snapshot(f.sqlite, "sports");
    const beforeDivisions = snapshot(f.sqlite, "divisions");
    const beforeAudit = snapshot(f.sqlite, "admin_audit_logs");
    for (const iconKey of [null, "", 3, false, {}, [], "NETBALL", "unknown-icon", "../private", "https://untrusted.example/icon.svg", "<svg/onload=alert(1)>"]) {
      const added = await addSport(f, activeId, { name: "잘못된 아이콘 검증", iconKey });
      assert.equal(added.status, 400);
      assert.equal(added.data.code, "INVALID_SPORT_ICON");
      const updated = await updateSport(f, sport, { iconKey });
      assert.equal(updated.status, 400);
      assert.equal(updated.data.code, "INVALID_SPORT_ICON");
    }
    assert.deepEqual(snapshot(f.sqlite, "sports"), beforeSports);
    assert.deepEqual(snapshot(f.sqlite, "divisions"), beforeDivisions);
    assert.deepEqual(snapshot(f.sqlite, "admin_audit_logs"), beforeAudit);
  } finally { f.sqlite.close(); }
});

test("the sport-icon migration is additive and preserves all old schools, sport settings, credentials, sessions and responses", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec("PRAGMA foreign_keys = ON");
    const iconMigration = migrations.find((name) => name.endsWith("_sport_icons.sql"));
    assert.ok(iconMigration);
    await apply(sqlite, migrations.filter((name) => name < iconMigration));
    const start = new Date(Date.now() - 86400000).toISOString(), end = new Date(Date.now() + 86400000).toISOString();
    sqlite.prepare("UPDATE tournaments SET survey_start = ?, survey_end = ?").run(start, end);
    const eventId = sqlite.prepare("SELECT id FROM tournaments LIMIT 1").get().id;
    const schoolId = sqlite.prepare("SELECT id FROM schools WHERE school_level = 'middle' ORDER BY display_order LIMIT 1").get().id;
    const divisionId = sqlite.prepare("SELECT d.id FROM divisions d JOIN sports s ON s.id = d.sport_id WHERE s.tournament_id = ? LIMIT 1").get(eventId).id;
    sqlite.prepare("INSERT INTO responses (tournament_id, school_id, revision) VALUES (?, ?, 2)").run(eventId, schoolId);
    sqlite.prepare("INSERT INTO response_items (tournament_id, school_id, division_id, team_count) VALUES (?, ?, ?, 1)").run(eventId, schoolId, divisionId);
    sqlite.prepare("INSERT INTO sessions (token_hash, actor_type, school_id, tournament_id, expires_at) VALUES ('isolated-existing-session', 'school', ?, ?, '2099-01-01T00:00:00Z')").run(schoolId, eventId);
    const tables = ["schools", "tournaments", "sports", "divisions", "responses", "response_items", "sessions", "admin_credentials", "app_config", "admin_audit_logs"];
    const before = Object.fromEntries(tables.map((table) => [table, snapshot(sqlite, table)]));
    const sql = await readFile(new URL(`drizzle/${iconMigration}`, root), "utf8");
    assert.match(sql, /ALTER TABLE.*sports.*ADD.*icon_key.*DEFAULT 'auto'/s);
    assert.doesNotMatch(sql, /\b(?:DELETE|UPDATE|DROP|INSERT)\b/i);
    await apply(sqlite, [iconMigration]);
    for (const table of tables) {
      const after = snapshot(sqlite, table).map((row) => { if (table !== "sports") return row; const { icon_key, ...legacy } = row; assert.equal(icon_key, "auto"); return legacy; });
      assert.deepEqual(after, before[table], table + " previous fields must remain identical");
    }
    assert.equal(sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { sqlite.close(); }
});
