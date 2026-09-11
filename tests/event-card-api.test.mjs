import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { eventCardCopy, normalizeEventCardCopy, formatEventCardDate } from "../app/event-card-copy.js";

// Run the real handler against SQLite in memory. No production credentials,
// HTTP calls, or local/remote application databases are used by these checks.
const sourceUrl = new URL("../worker/api.ts", import.meta.url);
const source = (await readFile(sourceUrl, "utf8"))
  .replace('"./school-password.js"', JSON.stringify(new URL("../worker/school-password.js", import.meta.url).href))
  .replace('"./team-limits.js"', JSON.stringify(new URL("../worker/team-limits.js", import.meta.url).href))
  .replace('"../app/event-card-copy.js"', JSON.stringify(new URL("../app/event-card-copy.js", import.meta.url).href));
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
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

async function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const migrations = new URL("../drizzle/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((file) => file.endsWith(".sql")).sort()) sqlite.exec(await readFile(new URL(file, migrations), "utf8"));
  const env = { DB: new TestD1(sqlite), ADMIN_USERNAME: "preview-test-admin", ADMIN_PASSWORD: randomBytes(16).toString("hex"), SCHOOL_PASSWORD_PEPPER: randomBytes(24).toString("hex") };
  const start = new Date(Date.now() - 86_400_000).toISOString();
  const end = new Date(Date.now() + 86_400_000).toISOString();
  sqlite.prepare("UPDATE tournaments SET name = ?, survey_start = ?, survey_end = ?").run("2026학년도 하반기 동부동락 학교스포츠클럽대회", start, end);
  const salt = randomBytes(16);
  const code = "동다99";
  const hash = pbkdf2Sync(code + env.SCHOOL_PASSWORD_PEPPER, salt, 1000, 32, "sha256").toString("base64url");
  sqlite.prepare("INSERT INTO schools (id,name,display_order,password_salt,password_hash,password_iterations) VALUES (?,?,?,?,?,?)").run("test-school", "검증중학교", 99, salt.toString("base64url"), hash, 1000);
  async function call(path, { method = "GET", body, cookie, origin = "https://test.example" } = {}) {
    const response = await handleApi(new Request(`https://test.example/api/${path}`, { method, headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
    return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0], headers: response.headers };
  }
  const admin = await call("admin/login", { method: "POST", body: { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD } });
  assert.equal(admin.status, 200);
  return { sqlite, call, cookie: admin.cookie, start, end };
}

test("card period uses Korean weekdays and correct Seoul dates and times", () => {
  assert.equal(formatEventCardDate("2026-09-13T15:00:00.000Z"), "09.14.(월) 00:00");
  assert.equal(formatEventCardDate("2026-09-18T08:00:00.000Z"), "09.18.(금) 17:00");
  assert.equal(formatEventCardDate("2026-09-13T14:59:00.000Z"), "09.13.(일) 23:59");
  assert.equal(formatEventCardDate("2026-09-18 08:00:00"), "09.18.(금) 17:00");
  assert.equal(formatEventCardDate("invalid"), "-");
});

test("card copy has event-aware defaults, explicit hiding and bounded plain text", () => {
  const current = { academicYear: 2026, name: "하반기 동부동락 대회", cardCopy: "{}" };
  assert.equal(eventCardCopy(current).title, "동부동락");
  assert.equal(eventCardCopy(current).description, "2026학년도 하반기 참가 신청");
  assert.equal(eventCardCopy({ academicYear: 2027, name: "새 전반기 대회" }).title, "새 전반기 대회");
  assert.equal(eventCardCopy({ ...current, academicYear: 2027 }).description, "2027학년도 하반기 참가 신청");
  assert.equal(eventCardCopy(current, { subtitle: "" }).subtitle, "");
  assert.deepEqual(normalizeEventCardCopy({ title: " 첫째 줄\r\n둘째 줄 ", ignored: "not stored" }), { title: "첫째 줄\n둘째 줄" });
  assert.throws(() => normalizeEventCardCopy({ title: "가".repeat(101) }));
  assert.throws(() => normalizeEventCardCopy({ title: 123 }));
  for (const value of [null, [], "bad"]) assert.throws(() => normalizeEventCardCopy(value));
  assert.equal(eventCardCopy({ ...current, cardCopy: "malformed" }).title, "동부동락");
});

test("card settings are admin-only, per-event, persistent and backward compatible", async () => {
  const { sqlite, call, cookie, start, end } = await fixture();
  try {
    const boot = await call("bootstrap");
    assert.equal(boot.status, 200);
    assert.equal(boot.data.schools.length, 43);
    assert.equal(boot.data.tournament.cardCopy, "{}");
    assert.doesNotMatch(JSON.stringify(boot.data), /passwordHash|passwordSalt|pepper/);
    const id = boot.data.tournament.id;
    const path = `admin/events/${id}/card-copy`;
    const body = { cardCopy: { title: "새 대회\n동부동락", subtitle: "학교스포츠클럽대회", description: "<script>text only</script>" } };
    assert.equal((await call(path, { method: "PATCH", body })).status, 401);
    assert.equal((await call(path, { method: "PATCH", body, cookie, origin: "https://untrusted.example" })).status, 403);
    assert.equal((await call(path, { method: "PATCH", body: null, cookie })).status, 400);
    assert.equal((await call(path, { method: "PATCH", body: { cardCopy: { title: "x".repeat(101) } }, cookie })).status, 400);
    assert.equal((await call(path, { method: "PATCH", body, cookie })).status, 200);
    assert.deepEqual(JSON.parse((await call("bootstrap")).data.tournament.cardCopy), body.cardCopy);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM admin_audit_logs WHERE entity_type = 'tournament_card'").get().n, 1);
    // Older event forms don't know about card copy and must leave it untouched.
    assert.equal((await call(`admin/events/${id}`, { method: "PATCH", cookie, body: { academicYear: 2027, name: "변경된 대회", surveyStart: start, surveyEnd: end } })).status, 200);
    assert.deepEqual(JSON.parse((await call("bootstrap")).data.tournament.cardCopy), body.cardCopy);
    const second = await call("admin/events", { method: "POST", cookie, body: { academicYear: 2028, name: "다른 대회", surveyStart: start, surveyEnd: end } });
    assert.equal(second.status, 201);
    const secondDashboard = await call(`admin/dashboard?eventId=${second.data.id}`, { cookie });
    assert.equal(secondDashboard.data.selectedEvent.cardCopy, "{}");
    assert.equal((await call(`admin/events/${second.data.id}/card-copy`, { method: "PATCH", cookie, body: { cardCopy: { title: "다른 제목" } } })).status, 200);
    assert.deepEqual(JSON.parse((await call("bootstrap")).data.tournament.cardCopy), body.cardCopy);
    assert.equal((await call("admin/dashboard", { cookie })).data.selectedEvent.id, id);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM schools").get().n, 43);
  } finally { sqlite.close(); }
});

test("real login/save/readback retains team limits, nonparticipation, logout and deadline protection", async () => {
  const { sqlite, call } = await fixture();
  try {
    let school = await call("school/login", { method: "POST", body: { schoolId: "test-school", password: "ehdek99" } });
    assert.equal(school.status, 200);
    assert.match(school.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Strict/);
    const cookie = school.cookie;
    const selection = (divisionId, teamCount) => ({ divisionId, teamCount });
    const save = (selections, revision, noParticipation = false) => call("school/survey", { method: "PUT", cookie, body: { selections, revision, noParticipation } });
    assert.equal((await save([selection("division-basketball-male", 2)], 0)).data.code, "DIVISION_TEAM_LIMIT_EXCEEDED");
    assert.equal((await save([selection("division-volleyball-male", 2), selection("division-volleyball-female", 1)], 0)).data.code, "SCHOOL_TEAM_LIMIT_EXCEEDED");
    const valid = [selection("division-basketball-male", 1), selection("division-basketball-female", 1)];
    const saved = await save(valid, 0);
    assert.equal(saved.status, 200);
    assert.equal(saved.data.survey.revision, 1);
    assert.equal((await save(valid, 0)).data.code, "REVISION_CONFLICT");
    const restored = await call("school/session", { cookie });
    assert.equal(restored.data.survey.selections.length, 2);
    assert.equal(restored.data.tournament.cardCopy, "{}");
    assert.equal((await save([], 1, true)).status, 200);
    assert.equal((await call("school/session", { cookie })).data.survey.noParticipation, true);
    assert.equal((await save(valid, 2)).status, 200);
    assert.equal((await call("school/logout", { method: "POST", body: {}, cookie })).status, 200);
    assert.equal((await call("school/session", { cookie })).status, 401);
    school = await call("school/login", { method: "POST", body: { schoolId: "test-school", password: "동다99" } });
    assert.equal(school.data.survey.selections.length, 2);
    sqlite.prepare("UPDATE tournaments SET survey_end = ?").run(new Date(Date.now() - 1000).toISOString());
    assert.equal((await call("school/session", { cookie: school.cookie })).status, 403);
    assert.equal((await call("school/login", { method: "POST", body: { schoolId: "test-school", password: "ehdek99" } })).status, 403);
  } finally { sqlite.close(); }
});
