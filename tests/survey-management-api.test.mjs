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
    if (this.beforeNextBatch) { const hook = this.beforeNextBatch; this.beforeNextBatch = null; hook(); }
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
  const env = { DB: new TestD1(sqlite), LOGO_FILES: { async get() { return { body: new Uint8Array([137, 80, 78, 71]), size: 4 }; } }, ADMIN_USERNAME: "isolated-admin", ADMIN_PASSWORD: randomBytes(16).toString("hex"), SCHOOL_PASSWORD_PEPPER: randomBytes(24).toString("hex") };
  const start = new Date(Date.now() - 86_400_000).toISOString();
  const end = new Date(Date.now() + 86_400_000).toISOString();
  sqlite.prepare("UPDATE tournaments SET survey_start = ?, survey_end = ?").run(start, end);
  for (const [id, name, level, order, code] of [["test-middle", "검증중학교", "middle", 99, "동다99"], ["test-elementary", "검증초등학교", "elementary", 99, "동나99"], ["test-elementary-b", "별빛검증초등학교", "elementary", 98, "동너99"]]) {
    const salt = randomBytes(16);
    const hash = pbkdf2Sync(code + env.SCHOOL_PASSWORD_PEPPER, salt, 1000, 32, "sha256").toString("base64url");
    sqlite.prepare("INSERT INTO schools (id,name,school_level,display_order,password_salt,password_hash,password_iterations) VALUES (?,?,?,?,?,?,?)").run(id, name, level, order, salt.toString("base64url"), hash, 1000);
  }
  async function call(path, { method = "GET", body, cookie, origin = "https://isolated.example" } = {}) {
    const response = await handleApi(new Request(`https://isolated.example/api/${path}`, { method, headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
    return { status: response.status, data: response.headers.get("content-type")?.startsWith("image/") ? Buffer.from(await response.arrayBuffer()) : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
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

const schoolLogin = (f, tournamentId, schoolId = "test-middle", password = "ehdek99") => f.call("school/login", { method: "POST", body: { tournamentId, schoolId, password } });
const save = (f, session, selections = [], extra = {}) => f.call("school/survey", { method: "PUT", cookie: session.cookie, body: { tournamentId: session.data.tournament.id, schoolId: session.data.school.id, revision: 0, noParticipation: !selections.length, selections, ...extra } });
const unpublish = (f, id) => f.call(`admin/events/${id}/unpublish`, { method: "POST", cookie: f.cookie, body: {} });
const addSchool = (f, body, options = {}) => f.call("admin/schools", { method: "POST", cookie: f.cookie, body, ...options });

test("parallel publications preserve prior surveys, have explicit selection, and default to an open published survey", async () => {
  const f = await fixture();
  try {
    const before = (await f.call("bootstrap")).data;
    const first = before.tournament.id;
    const draft = await f.create(["middle"]);
    const second = draft.data.id;
    assert.equal((await f.call(`bootstrap?tournamentId=${second}`)).status, 404);
    assert.equal((await schoolLogin(f, second)).status, 404);
    assert.equal((await f.call("bootstrap?tournamentId=missing")).status, 404);
    await f.activate(second);
    const after = (await f.call("bootstrap")).data;
    assert.equal(after.tournament.id, second);
    assert.equal(after.defaultEventId, second);
    assert.equal(after.tournaments.length, 2);
    assert.ok(after.tournaments.every((event) => event.status === "active" && event.surveyState.open));
    assert.deepEqual((await f.call(`bootstrap?tournamentId=${first}`)).data.tournament, before.tournament);
    assert.equal((await f.dashboard(first)).defaultEventId, second);
    // Publishing a not-yet-open survey must not strand visitors away from another open survey.
    f.sqlite.prepare("UPDATE tournaments SET survey_start = '2099-01-01', survey_end = '2099-02-01' WHERE id = ?").run(second);
    assert.equal((await f.call("bootstrap")).data.tournament.id, first);
    assert.equal((await f.call(`bootstrap?tournamentId=${second}`)).data.surveyState.code, "NOT_STARTED");
    assert.equal((await schoolLogin(f, second)).status, 403);
    f.sqlite.prepare("UPDATE tournaments SET survey_start = '2020-01-01', survey_end = '2020-02-01' WHERE id = ?").run(second);
    assert.equal((await f.call(`bootstrap?tournamentId=${second}`)).data.surveyState.code, "ENDED");
    assert.equal((await schoolLogin(f, second)).status, 403);
    assert.equal((await f.call("bootstrap")).data.tournament.id, first);
    assert.equal((await unpublish(f, first)).status, 200);
    assert.equal((await f.call("bootstrap")).data.tournament.id, second);
    assert.equal((await unpublish(f, second)).status, 200);
    const empty = (await f.call("bootstrap")).data;
    assert.equal(empty.tournament, null);
    assert.equal(empty.defaultEventId, null);
    assert.deepEqual(empty.tournaments, []);
    assert.deepEqual(empty.schools, []);
    assert.equal((await f.dashboard(first)).events.length, 2);
    assert.equal((await unpublish(f, "missing")).status, 404);
    assert.equal((await f.call(`admin/events/${first}/unpublish`, { method: "POST", body: {} })).status, 401);
  } finally { f.sqlite.close(); }
});

test("survey-bound sessions support parallel results and strictly reject cross-survey and cross-school stale tabs", async () => {
  const f = await fixture();
  try {
    const firstId = (await f.call("bootstrap")).data.tournament.id;
    const first = await schoolLogin(f, firstId);
    const secondId = (await f.create(["middle"])).data.id;
    await f.activate(secondId);
    const second = await schoolLogin(f, secondId);
    assert.equal(first.status, 200); assert.equal(second.status, 200);
    assert.equal((await f.call(`school/session?tournamentId=${firstId}`, { cookie: first.cookie })).status, 200);
    for (const path of ["school/session", "school/participants"]) {
      const mismatch = await f.call(`${path}?tournamentId=${firstId}`, { cookie: second.cookie });
      assert.equal(mismatch.status, 409);
      assert.equal(mismatch.data.code, "EVENT_CHANGED");
    }
    // A shared browser cookie from tab B must never save tab A's empty/no-participation response into B.
    const staleBody = { tournamentId: firstId, schoolId: "test-middle", revision: 0, noParticipation: true, selections: [] };
    assert.equal((await f.call("school/survey", { method: "PUT", cookie: second.cookie, body: staleBody })).data.code, "EVENT_CHANGED");
    for (const body of [{ ...staleBody, tournamentId: undefined }, { ...staleBody, schoolId: undefined }, { ...staleBody, tournamentId: null }, { revision: 0, noParticipation: true }]) {
      assert.equal((await f.call("school/survey", { method: "PUT", cookie: first.cookie, body })).status, 409);
    }
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM responses").get().n, 0);
    const firstDivision = first.data.sports[0].divisions[0].id;
    assert.equal((await save(f, second, [{ divisionId: firstDivision, teamCount: 1 }])).status, 400);
    assert.equal((await save(f, first, [{ divisionId: firstDivision, teamCount: 1 }])).status, 200);
    assert.equal((await save(f, second)).status, 200);
    assert.equal((await f.dashboard(firstId)).rows.find((row) => row.school.id === "test-middle").noParticipation, false);
    assert.equal((await f.dashboard(secondId)).rows.find((row) => row.school.id === "test-middle").noParticipation, true);
    const other = await addSchool(f, { name: "교차탭검증중학교", schoolLevel: "middle", institutionCode: "동다9876" });
    assert.equal(other.status, 201);
    const otherSession = await schoolLogin(f, firstId, other.data.id, "ehdek9876");
    assert.equal(otherSession.status, 200);
    assert.equal((await f.call(`school/participants?tournamentId=${firstId}&schoolId=test-middle`, { cookie: otherSession.cookie })).data.code, "SCHOOL_CHANGED");
    assert.equal((await f.call("school/survey", { method: "PUT", cookie: otherSession.cookie, body: staleBody })).data.code, "SCHOOL_CHANGED");
    assert.equal((await f.dashboard(firstId)).rows.find((row) => row.school.id === other.data.id).submitted, false);
    assert.equal((await unpublish(f, firstId)).status, 200);
    for (const path of ["school/session", "school/participants"]) assert.equal((await f.call(`${path}?tournamentId=${firstId}`, { cookie: first.cookie })).data.code, "SURVEY_CLOSED");
    assert.equal((await save(f, first, [], { revision: 1 })).data.code, "SURVEY_CLOSED");
    assert.equal((await f.call(`school/session?tournamentId=${secondId}`, { cookie: second.cookie })).status, 200);
    assert.equal((await f.dashboard(firstId)).rows.find((row) => row.school.id === "test-middle").submitted, true);
  } finally { f.sqlite.close(); }
});

test("every published logo stays public independent of the default pointer, while unpublished logos are admin-only", async () => {
  const f = await fixture();
  try {
    const first = (await f.call("bootstrap")).data.tournament.id;
    const second = (await f.create(["middle"])).data.id;
    const firstKey = crypto.randomUUID(), secondKey = crypto.randomUUID();
    f.sqlite.prepare("UPDATE tournaments SET logo_key = ? WHERE id = ?").run(firstKey, first);
    f.sqlite.prepare("UPDATE tournaments SET logo_key = ? WHERE id = ?").run(secondKey, second);
    const pathA = `events/${first}/logo/${firstKey}`, pathB = `events/${second}/logo/${secondKey}`;
    assert.equal((await f.call(pathB)).status, 401);
    assert.equal((await f.call(pathB, { cookie: f.cookie })).status, 200);
    await f.activate(second);
    assert.equal((await f.call(pathA)).status, 200);
    assert.equal((await f.call(pathB)).status, 200);
    f.sqlite.prepare("UPDATE tournaments SET survey_start = '2099-01-01', survey_end = '2099-02-01' WHERE id = ?").run(first);
    assert.equal((await f.call(pathA)).status, 200);
    f.sqlite.prepare("UPDATE tournaments SET survey_start = '2020-01-01', survey_end = '2020-02-01' WHERE id = ?").run(first);
    assert.equal((await f.call(pathA)).status, 200);
    await unpublish(f, first);
    assert.equal((await f.call(pathA)).status, 401);
    assert.equal((await f.call(pathB)).status, 200);
    assert.equal((await f.call(pathA, { cookie: f.cookie })).status, 200);
  } finally { f.sqlite.close(); }
});

test("admin school registration is private, validates codes, rejects duplicates, and never discloses credentials", async () => {
  const f = await fixture();
  try {
    const first = (await f.call("bootstrap")).data.tournament.id;
    const school = await schoolLogin(f, first);
    for (const cookie of [undefined, school.cookie]) {
      assert.equal((await f.call("admin/schools", { cookie })).status, 401);
      assert.equal((await addSchool(f, { name: "검증학교", schoolLevel: "middle", institutionCode: "동다9876" }, { cookie })).status, 401);
    }
    assert.equal((await addSchool(f, { name: "검증학교", schoolLevel: "middle", institutionCode: "동다9876" }, { origin: "https://bad.example" })).status, 403);
    for (const body of [
      { name: "검증학교", schoolLevel: "high", institutionCode: "동다9876" },
      { name: "", schoolLevel: "middle", institutionCode: "동다9876" },
      { name: "잘못된\n학교", schoolLevel: "middle", institutionCode: "동다9876" },
      { name: "검증학교", schoolLevel: "elementary", institutionCode: "동다9876" },
      { name: "검증학교", schoolLevel: "middle", institutionCode: "동나9876" },
      ...["ehsk99", "동다9", "동다12345", "동다99suffix", "동다 99", "arbitrary"].map((institutionCode) => ({ name: "검증학교", schoolLevel: "middle", institutionCode })),
    ]) assert.equal((await addSchool(f, body)).status, 400);
    const before = f.sqlite.prepare("SELECT * FROM schools ORDER BY id").all();
    assert.equal((await addSchool(f, { name: "새이름검증중학교", schoolLevel: "middle", institutionCode: "ehdek99" })).data.code, "DUPLICATE_INSTITUTION_CODE", "legacy salted hashes must also protect duplicate codes");
    const added = await addSchool(f, { name: "새학교검증초등학교", schoolLevel: "elementary", institutionCode: " EHDSJ9876 " });
    assert.equal(added.status, 201);
    assert.equal(added.data.school.schoolLevel, "elementary");
    assert.equal(added.data.school.displayOrder, 100);
    assert.equal((await addSchool(f, { name: "새학교검증초등학교".normalize("NFD"), schoolLevel: "elementary", institutionCode: "동나9875" })).data.code, "DUPLICATE_SCHOOL");
    assert.equal((await addSchool(f, { name: "다른새학교검증초등학교", schoolLevel: "elementary", institutionCode: "동너9876" })).data.code, "DUPLICATE_INSTITUTION_CODE");
    const row = f.sqlite.prepare("SELECT * FROM schools WHERE id = ?").get(added.data.id);
    assert.equal(row.password_iterations, 25000);
    assert.notEqual(row.password_hash, "동너9876");
    assert.ok(row.eligible_from);
    const expected = pbkdf2Sync("동너9876" + f.env.SCHOOL_PASSWORD_PEPPER, Buffer.from(row.password_salt, "base64url"), 25000, 32, "sha256").toString("base64url");
    assert.equal(row.password_hash, expected);
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM schools WHERE id <> ? ORDER BY id").all(added.data.id), before);
    const list = await f.call("admin/schools", { cookie: f.cookie });
    const serialized = JSON.stringify([added.data, list.data, f.sqlite.prepare("SELECT action, entity_type, detail FROM admin_audit_logs WHERE entity_type = 'school'").all()]);
    for (const privateValue of ["동너9876", "EHDSJ9876", row.password_salt, row.password_hash, "passwordSalt", "passwordHash", "institutionCode"]) assert.ok(!serialized.includes(privateValue));
    const audit = f.sqlite.prepare("SELECT detail FROM admin_audit_logs WHERE entity_type = 'school' AND entity_id = ?").get(added.data.id);
    assert.deepEqual(JSON.parse(audit.detail), { name: "새학교검증초등학교", schoolLevel: "elementary" });
    const both = (await f.create(["elementary", "middle"])).data.id;
    await f.activate(both);
    assert.equal((await schoolLogin(f, both, added.data.id, "ehdsj9876")).status, 200);
  } finally { f.sqlite.close(); }
});

test("new school eligibility preserves ended historical denominators and uses strict UTC end boundaries", async () => {
  const f = await fixture();
  try {
    const current = (await f.call("bootstrap")).data.tournament.id;
    const historical = await f.call("admin/events", { method: "POST", cookie: f.cookie, body: { ...f.payload, surveyStart: "2020-01-01T00:00:00.000Z", surveyEnd: "2020-02-01T00:00:00.000Z" } });
    const historicalId = historical.data.id;
    const oldRows = (await f.dashboard(historicalId)).rows;
    assert.equal(oldRows.length, 43);
    const created = await addSchool(f, { name: "이후등록검증중학교", schoolLevel: "middle", institutionCode: "동더9876" });
    assert.equal(created.status, 201);
    assert.deepEqual((await f.dashboard(historicalId)).rows, oldRows);
    assert.equal((await f.dashboard(current)).rows.length, 44);
    const loggedIn = await schoolLogin(f, current, created.data.id, "ehdej9876");
    assert.equal(loggedIn.status, 200);
    const end = f.sqlite.prepare("SELECT survey_end FROM tournaments WHERE id = ?").get(current).survey_end;
    // SQLite legacy timestamps use a space; ISO values use T/Z. Equality must still exclude the school.
    f.sqlite.prepare("UPDATE schools SET eligible_from = ? WHERE id = ?").run(end.replace("T", " ").replace("Z", ""), created.data.id);
    assert.equal((await f.call(`bootstrap?tournamentId=${current}`)).data.schools.some((school) => school.id === created.data.id), false);
    assert.equal((await schoolLogin(f, current, created.data.id, "동더9876")).status, 401);
    assert.equal((await f.call(`school/session?tournamentId=${current}`, { cookie: loggedIn.cookie })).data.code, "SCHOOL_NOT_ELIGIBLE");
    assert.equal((await save(f, loggedIn)).data.code, "SCHOOL_NOT_ELIGIBLE");
    f.sqlite.prepare("UPDATE schools SET eligible_from = ? WHERE id = ?").run(new Date(new Date(end).getTime() - 1000).toISOString(), created.data.id);
    assert.equal((await f.call(`bootstrap?tournamentId=${current}`)).data.schools.some((school) => school.id === created.data.id), true);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM schools WHERE eligible_from IS NULL").get().n, 118);
    assert.equal(f.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { f.sqlite.close(); }
});

test("failed school insert/audit batch is atomic and canonical codes support only 2–4 digits", async () => {
  const f = await fixture();
  try {
    const beforeSchools = f.sqlite.prepare("SELECT * FROM schools ORDER BY id").all();
    const beforeAudit = f.sqlite.prepare("SELECT * FROM admin_audit_logs ORDER BY id").all();
    f.env.DB.failNextBatch = true;
    const failed = await addSchool(f, { name: "실패검증중학교", schoolLevel: "middle", institutionCode: "동다8765" });
    assert.equal(failed.status, 503);
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM schools ORDER BY id").all(), beforeSchools);
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM admin_audit_logs ORDER BY id").all(), beforeAudit);
    for (const [prefix, korean] of [["ehdek", "동다"], ["ehdej", "동더"], ["ehdsk", "동나"], ["ehdsj", "동너"]]) {
      for (const suffix of ["99", "999", "9999"]) assert.equal(normalizeSchoolPasswordInput(prefix + suffix), korean + suffix);
      for (const suffix of ["9", "99999", "99suffix"]) assert.equal(normalizeSchoolPasswordInput(prefix + suffix), prefix + suffix);
    }
  } finally { f.sqlite.close(); }
});

test("atomic save guards preserve prior responses if publication, deadline, or school eligibility changes before the batch", async () => {
  for (const change of ["unpublish", "deadline", "eligibility"]) {
    const f = await fixture();
    try {
      const eventId = (await f.call("bootstrap")).data.tournament.id;
      const session = await schoolLogin(f, eventId);
      const selections = [{ divisionId: session.data.sports[0].divisions[0].id, teamCount: 1 }];
      assert.equal((await save(f, session, selections)).status, 200);
      const before = { responses: f.sqlite.prepare("SELECT * FROM responses").all(), items: f.sqlite.prepare("SELECT * FROM response_items").all() };
      f.env.DB.beforeNextBatch = () => {
        if (change === "unpublish") f.sqlite.prepare("UPDATE tournaments SET status = 'draft' WHERE id = ?").run(eventId);
        if (change === "deadline") f.sqlite.prepare("UPDATE tournaments SET survey_end = '2020-01-01' WHERE id = ?").run(eventId);
        if (change === "eligibility") f.sqlite.prepare("UPDATE schools SET eligible_from = '2099-01-01' WHERE id = 'test-middle'").run();
      };
      const rejected = await save(f, session, [], { revision: 1 });
      assert.equal(rejected.status, 403, change);
      assert.equal(rejected.data.code, "SURVEY_CLOSED");
      assert.deepEqual(f.sqlite.prepare("SELECT * FROM responses").all(), before.responses);
      assert.deepEqual(f.sqlite.prepare("SELECT * FROM response_items").all(), before.items);
      assert.throws(() => f.sqlite.prepare("UPDATE responses SET no_participation = 1 WHERE tournament_id = ?").run(eventId), /SURVEY_NOT_WRITABLE/);
    } finally { f.sqlite.close(); }
  }
});
