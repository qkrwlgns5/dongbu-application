import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes, createHmac } from "node:crypto";
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
    if (this.beforeNextBatch) { const hook = this.beforeNextBatch; this.beforeNextBatch = null; await hook(); }
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const [index, statement] of statements.entries()) {
        results.push(await statement.run());
        if (this.failAfterStatement === index) { this.failAfterStatement = undefined; throw new Error("Simulated write failure"); }
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

async function fixture({ legacyCustom = false } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  await apply(sqlite, migrations.filter((name) => name < "0012"));
  const env = { DB: new TestD1(sqlite), LOGO_FILES: { async get() { return { body: new Uint8Array([137, 80, 78, 71]), size: 4 }; } }, ADMIN_USERNAME: "isolated-admin", ADMIN_PASSWORD: randomBytes(16).toString("hex"), SCHOOL_PASSWORD_PEPPER: randomBytes(24).toString("hex") };
  const start = new Date(Date.now() - 86_400_000).toISOString();
  const end = new Date(Date.now() + 86_400_000).toISOString();
  sqlite.prepare("UPDATE tournaments SET survey_start = ?, survey_end = ?").run(start, end);
  for (const [id, name, level, order, code] of [["test-middle", "검증중학교", "middle", 99, "동다99"], ["test-elementary", "검증초등학교", "elementary", 99, "동나99"], ["test-elementary-b", "별빛검증초등학교", "elementary", 98, "동너99"]]) {
    const salt = randomBytes(16);
    const hash = pbkdf2Sync(code + env.SCHOOL_PASSWORD_PEPPER, salt, 1000, 32, "sha256").toString("base64url");
    sqlite.prepare("INSERT INTO schools (id,name,school_level,display_order,password_salt,password_hash,password_iterations) VALUES (?,?,?,?,?,?,?)").run(id, name, level, order, salt.toString("base64url"), hash, 1000);
  }
  let legacyCustomId = null, legacyCustomBefore = null;
  if (legacyCustom) {
    const code = "동더8765";
    const fingerprint = createHmac("sha256", env.SCHOOL_PASSWORD_PEPPER).update("school-institution-v1|" + code).digest("base64url");
    legacyCustomId = "school-custom-" + fingerprint;
    const salt = randomBytes(16);
    const hash = pbkdf2Sync(code + env.SCHOOL_PASSWORD_PEPPER, salt, 1000, 32, "sha256").toString("base64url");
    sqlite.prepare("INSERT INTO schools (id,name,school_level,display_order,password_salt,password_hash,password_iterations,eligible_from) VALUES (?,?,?,?,?,?,?,?)").run(legacyCustomId, "이전방식검증중학교", "middle", 100, salt.toString("base64url"), hash, 1000, start);
    legacyCustomBefore = { ...sqlite.prepare("SELECT * FROM schools WHERE id = ?").get(legacyCustomId) };
  }
  await apply(sqlite, migrations.filter((name) => name >= "0012"));
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
  return { sqlite, env, call, cookie, create, activate, dashboard, login, payload, legacyCustomId, legacyCustomBefore };
}

const schoolLogin = (f, tournamentId, schoolId = "test-middle", password = "ehdek99") => f.call("school/login", { method: "POST", body: { tournamentId, schoolId, password } });
const save = (f, session, selections = [], extra = {}) => f.call("school/survey", { method: "PUT", cookie: session.cookie, body: { tournamentId: session.data.tournament.id, schoolId: session.data.school.id, revision: 0, noParticipation: !selections.length, selections, ...extra } });
const unpublish = (f, id) => f.call(`admin/events/${id}/unpublish`, { method: "POST", cookie: f.cookie, body: {} });
const addSchool = (f, body, options = {}) => f.call("admin/schools", { method: "POST", cookie: f.cookie, body, ...options });

const rotate = (f, id, institutionCode, options = {}) => f.call(`admin/schools/${id}/institution-code`, { method: "PATCH", cookie: f.cookie, body: { institutionCode }, ...options });
const credentialRow = (f, id) => ({ ...f.sqlite.prepare("SELECT * FROM schools WHERE id = ?").get(id) });
function metadata(row) {
  const { password_salt, password_hash, password_iterations, institution_fingerprint, updated_at, ...publicFields } = row;
  return publicFields;
}
const responseSnapshot = (f) => ({ responses: f.sqlite.prepare("SELECT * FROM responses ORDER BY tournament_id, school_id").all(), items: f.sqlite.prepare("SELECT * FROM response_items ORDER BY tournament_id, school_id, division_id").all() });

test("institution-code editing requires administrator authentication and validates school-specific canonical codes", async () => {
  const f = await fixture();
  try {
    const eventId = (await f.call("bootstrap")).data.tournament.id;
    const school = await schoolLogin(f, eventId);
    for (const cookie of [undefined, school.cookie, "dongbu_admin_session=invalid"]) assert.equal((await rotate(f, "test-middle", "동다9876", { cookie })).status, 401);
    assert.equal((await rotate(f, "test-middle", "동다9876", { origin: "https://untrusted.example" })).status, 403);
    assert.equal((await rotate(f, "missing-school", "동다9876")).status, 404);
    for (const code of [undefined, null, 99, {}, "", "동나9876", "동너99", "동다9", "동다12345", "동다99extra", "동다 99", "ehsk99", "ehdek99x", "x".repeat(41)]) {
      const result = await rotate(f, "test-middle", code);
      assert.equal(result.status, 400);
      assert.equal(result.data.code, "INVALID_INSTITUTION_CODE");
    }
    for (const code of ["동다99", "동더99", "ehdek99", "ehdej99"]) assert.equal((await rotate(f, "test-elementary", code)).status, 400);
    const before = credentialRow(f, "test-middle");
    const sessionCount = f.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get().n;
    const auditCount = f.sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs").get().n;
    const unchanged = await rotate(f, "test-middle", " EHDEK99 ");
    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.data.changed, false);
    assert.equal(unchanged.data.sessionsRevoked, 0);
    assert.deepEqual(credentialRow(f, "test-middle"), before);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, sessionCount);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs").get().n, auditCount);
    f.env.SCHOOL_PASSWORD_PEPPER = undefined;
    assert.equal((await rotate(f, "test-middle", "동다9876")).status, 503);
  } finally { f.sqlite.close(); }
});

test("rotation preserves identity and all survey responses, revokes only target school sessions, and keeps credentials private", async () => {
  const f = await fixture();
  try {
    const firstId = (await f.call("bootstrap")).data.tournament.id;
    const first = await schoolLogin(f, firstId);
    const firstExtra = await schoolLogin(f, firstId);
    assert.equal((await save(f, first, [{ divisionId: first.data.sports[0].divisions[0].id, teamCount: 1 }])).status, 200);
    const secondId = (await f.create(["elementary", "middle"])).data.id;
    await f.activate(secondId);
    const second = await schoolLogin(f, secondId);
    assert.equal((await save(f, second)).status, 200);
    const other = await schoolLogin(f, secondId, "test-elementary", "ehdsk99");
    const schoolBefore = credentialRow(f, "test-middle");
    const responsesBefore = responseSnapshot(f);
    const otherSessionsBefore = f.sqlite.prepare("SELECT * FROM sessions WHERE school_id IS NULL OR school_id <> 'test-middle' ORDER BY token_hash").all();
    const oldCount = f.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions WHERE actor_type = 'school' AND school_id = 'test-middle'").get().n;
    const updated = await rotate(f, "test-middle", "EHDEJ9876");
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.data, { ok: true, changed: true, school: { id: "test-middle", name: "검증중학교", schoolLevel: "middle", displayOrder: 99 }, sessionsRevoked: oldCount });
    const schoolAfter = credentialRow(f, "test-middle");
    assert.deepEqual(metadata(schoolAfter), metadata(schoolBefore));
    assert.notEqual(schoolAfter.password_salt, schoolBefore.password_salt);
    assert.notEqual(schoolAfter.password_hash, schoolBefore.password_hash);
    assert.equal(schoolAfter.password_iterations, 25000);
    assert.equal(schoolAfter.institution_fingerprint.length, 43);
    assert.deepEqual(responseSnapshot(f), responsesBefore);
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM sessions WHERE school_id IS NULL OR school_id <> 'test-middle' ORDER BY token_hash").all(), otherSessionsBefore);
    for (const session of [first, firstExtra, second]) assert.equal((await f.call("school/session", { cookie: session.cookie })).status, 401);
    assert.equal((await f.call("school/session", { cookie: other.cookie })).status, 200);
    assert.equal((await f.call("admin/schools", { cookie: f.cookie })).status, 200);
    assert.equal((await schoolLogin(f, firstId, "test-middle", "ehdek99")).status, 401);
    const korean = await schoolLogin(f, firstId, "test-middle", "동더9876");
    const english = await schoolLogin(f, secondId, "test-middle", "ehdej9876");
    assert.equal(korean.status, 200); assert.equal(english.status, 200);
    assert.equal(korean.data.survey.selections.length, 1);
    assert.equal(english.data.survey.noParticipation, true);
    const audit = f.sqlite.prepare("SELECT detail FROM admin_audit_logs WHERE entity_type = 'school_institution_code' AND entity_id = 'test-middle'").get();
    assert.deepEqual(JSON.parse(audit.detail), { sessionsRevoked: oldCount });
    const publicData = JSON.stringify([updated.data, (await f.call("admin/schools", { cookie: f.cookie })).data, (await f.call("bootstrap")).data, korean.data, english.data, audit]);
    for (const secret of ["동더9876", "EHDEJ9876", schoolBefore.password_salt, schoolBefore.password_hash, schoolAfter.password_salt, schoolAfter.password_hash, schoolAfter.institution_fingerprint, "institution_fingerprint", "institutionFingerprint"]) assert.ok(!publicData.includes(secret));
    assert.equal(f.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { f.sqlite.close(); }
});

test("legacy fingerprint-ID migration preserves every old column and frees the old institution code without changing the school ID", async () => {
  const f = await fixture({ legacyCustom: true });
  try {
    const id = f.legacyCustomId;
    const { institution_fingerprint: fingerprint, ...afterMigration } = credentialRow(f, id);
    assert.deepEqual(afterMigration, f.legacyCustomBefore);
    assert.equal(fingerprint, id.slice("school-custom-".length));
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM schools WHERE institution_fingerprint IS NOT NULL").get().n, 1);
    const eventId = (await f.call("bootstrap")).data.tournament.id;
    const loggedIn = await schoolLogin(f, eventId, id, "ehdej8765");
    assert.equal(loggedIn.status, 200);
    assert.equal((await save(f, loggedIn, [{ divisionId: loggedIn.data.sports[0].divisions[0].id, teamCount: 1 }])).status, 200);
    const responsesBefore = responseSnapshot(f);
    assert.equal((await addSchool(f, { name: "중복코드검증중학교", schoolLevel: "middle", institutionCode: "동더8765" })).data.code, "DUPLICATE_INSTITUTION_CODE");
    assert.equal((await rotate(f, id, "동다8765")).status, 200);
    assert.deepEqual(responseSnapshot(f), responsesBefore);
    assert.equal(credentialRow(f, id).id, id);
    assert.notEqual(credentialRow(f, id).institution_fingerprint, fingerprint);
    const reused = await addSchool(f, { name: "이전번호재사용검증중학교", schoolLevel: "middle", institutionCode: "EHDEJ8765" });
    assert.equal(reused.status, 201);
    assert.match(reused.data.id, /^school-custom-[a-f0-9-]{36}$/u);
    assert.notEqual(reused.data.id, id);
    assert.equal(credentialRow(f, reused.data.id).institution_fingerprint, fingerprint);
    assert.equal((await schoolLogin(f, eventId, id, "동더8765")).status, 401);
    assert.equal((await schoolLogin(f, eventId, id, "ehdek8765")).status, 200);
    assert.equal((await schoolLogin(f, eventId, reused.data.id, "ehdej8765")).status, 200);
    assert.deepEqual(responseSnapshot(f), responsesBefore);
    assert.equal(f.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { f.sqlite.close(); }
});

test("legacy and newly assigned duplicate codes are rejected, and failed rotation rolls back credentials, sessions and audit", async () => {
  const f = await fixture();
  try {
    assert.equal((await rotate(f, "test-elementary", "동너99")).data.code, "DUPLICATE_INSTITUTION_CODE");
    const created = await addSchool(f, { name: "새번호검증중학교", schoolLevel: "middle", institutionCode: "동다8765" });
    assert.equal(created.status, 201);
    assert.equal((await rotate(f, "test-middle", "ehdek8765")).data.code, "DUPLICATE_INSTITUTION_CODE");
    const eventId = (await f.call("bootstrap")).data.tournament.id;
    await schoolLogin(f, eventId);
    for (const statement of [0, 1, 2]) {
      const before = { school: credentialRow(f, "test-middle"), sessions: f.sqlite.prepare("SELECT * FROM sessions ORDER BY token_hash").all(), audit: f.sqlite.prepare("SELECT * FROM admin_audit_logs ORDER BY id").all() };
      f.env.DB.failAfterStatement = statement;
      const failed = await rotate(f, "test-middle", "동더9876");
      assert.equal(failed.status, 503);
      assert.deepEqual(credentialRow(f, "test-middle"), before.school);
      assert.deepEqual(f.sqlite.prepare("SELECT * FROM sessions ORDER BY token_hash").all(), before.sessions);
      assert.deepEqual(f.sqlite.prepare("SELECT * FROM admin_audit_logs ORDER BY id").all(), before.audit);
    }
  } finally { f.sqlite.close(); }
});

test("concurrent administrators cannot silently overwrite the same school or assign the same code to two schools", async () => {
  const f = await fixture();
  try {
    const secondAdmin = await f.call("admin/login", { method: "POST", body: { username: f.env.ADMIN_USERNAME, password: f.env.ADMIN_PASSWORD } });
    let winner;
    f.env.DB.beforeNextBatch = async () => { winner = await rotate(f, "test-middle", "동다8765", { cookie: secondAdmin.cookie }); };
    const stale = await rotate(f, "test-middle", "동다8766");
    assert.equal(winner.status, 200);
    assert.equal(stale.status, 409);
    assert.equal(stale.data.code, "SCHOOL_CREDENTIAL_CHANGED");
    const eventId = (await f.call("bootstrap")).data.tournament.id;
    assert.equal((await schoolLogin(f, eventId, "test-middle", "ehdek8765")).status, 200);
    assert.equal((await schoolLogin(f, eventId, "test-middle", "동다8766")).status, 401);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs WHERE entity_type = 'school_institution_code' AND entity_id = 'test-middle'").get().n, 1);
    const other = await addSchool(f, { name: "경합검증중학교", schoolLevel: "middle", institutionCode: "동더8765" });
    const targetBefore = credentialRow(f, "test-middle");
    f.env.DB.beforeNextBatch = async () => { winner = await rotate(f, other.data.id, "동다8767", { cookie: secondAdmin.cookie }); };
    const duplicate = await rotate(f, "test-middle", "ehdek8767");
    assert.equal(winner.status, 200);
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.data.code, "DUPLICATE_INSTITUTION_CODE");
    assert.deepEqual(credentialRow(f, "test-middle"), targetBefore);
    f.env.DB.beforeNextBatch = async () => { winner = await rotate(f, other.data.id, "동다8768", { cookie: secondAdmin.cookie }); };
    const registration = await addSchool(f, { name: "등록경합검증중학교", schoolLevel: "middle", institutionCode: "동다8768" });
    assert.equal(winner.status, 200);
    assert.equal(registration.data.code, "DUPLICATE_INSTITUTION_CODE");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM schools WHERE name = '등록경합검증중학교'").get().n, 0);
  } finally { f.sqlite.close(); }
});

test("a password verified before rotation cannot mint a late school session after revocation", async () => {
  const f = await fixture();
  try {
    const eventId = (await f.call("bootstrap")).data.tournament.id;
    const before = await schoolLogin(f, eventId);
    assert.equal(before.status, 200);
    let rotated;
    // Hook at the final session INSERT batch, after old credential verification has completed.
    f.env.DB.beforeNextBatch = async () => { rotated = await rotate(f, "test-middle", "동다8765"); };
    const late = await schoolLogin(f, eventId, "test-middle", "ehdek99");
    assert.equal(rotated.status, 200);
    assert.equal(rotated.data.sessionsRevoked, 1);
    assert.equal(late.status, 401);
    assert.equal(late.data.code, "INVALID_CREDENTIALS");
    assert.equal(late.cookie, undefined);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions WHERE school_id = 'test-middle'").get().n, 0);
    assert.equal((await f.call("school/session", { cookie: before.cookie })).status, 401);
    assert.equal((await schoolLogin(f, eventId, "test-middle", "EHDEK8765")).status, 200);
    assert.equal((await f.call("admin/schools", { cookie: f.cookie })).status, 200);
  } finally { f.sqlite.close(); }
});
