import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { stripTypeScriptTypes } from "node:module";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { eventCardCopy, normalizeEventCardCopy, formatEventCardDate } from "../app/event-card-copy.js";
import { PAGE_HEADER_FIELDS, pageHeaderCopy, normalizePageHeaderCopy } from "../app/page-header-copy.js";

// Run the real handler against SQLite in memory. No production credentials,
// HTTP calls, or local/remote application databases are used by these checks.
const sourceUrl = new URL("../worker/api.ts", import.meta.url);
const source = (await readFile(sourceUrl, "utf8"))
  .replace('"./school-password.js"', JSON.stringify(new URL("../worker/school-password.js", import.meta.url).href))
  .replace('"./team-limits.js"', JSON.stringify(new URL("../worker/team-limits.js", import.meta.url).href))
  .replace('"./logo-image.js"', JSON.stringify(new URL("../worker/logo-image.js", import.meta.url).href))
  .replace('"../app/event-card-copy.js"', JSON.stringify(new URL("../app/event-card-copy.js", import.meta.url).href))
  .replace('"../app/school-levels.js"', JSON.stringify(new URL("../app/school-levels.js", import.meta.url).href))
  .replace('"../app/sport-icons.js"', JSON.stringify(new URL("../app/sport-icons.js", import.meta.url).href))
  .replace('"../app/page-header-copy.js"', JSON.stringify(new URL("../app/page-header-copy.js", import.meta.url).href));
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
    if (this.failNextBatch) { this.failNextBatch = false; throw new Error("Simulated D1 failure"); }
    this.sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

class TestR2 {
  objects = new Map();
  writes = 0;
  async put(key, bytes) {
    if (this.failPut) throw new Error("Simulated storage failure");
    this.writes++;
    this.objects.set(key, new Uint8Array(bytes));
  }
  async get(key) { const bytes = this.objects.get(key); return bytes ? { body: new Blob([bytes]).stream(), size: bytes.byteLength } : null; }
  async delete(key) { if (this.failDelete) throw new Error("Simulated cleanup failure"); this.objects.delete(key); }
}

function logoPng(width = 1, height = 1, compressed = deflateSync(Buffer.from([0, 24, 88, 76, 255]))) {
  function chunk(type, data) {
    const bytes = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, bytes, checksum]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))]);
}

async function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const migrations = new URL("../drizzle/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((file) => file.endsWith(".sql")).sort()) sqlite.exec(await readFile(new URL(file, migrations), "utf8"));
  const env = { DB: new TestD1(sqlite), LOGO_FILES: new TestR2(), ADMIN_USERNAME: "preview-test-admin", ADMIN_PASSWORD: randomBytes(16).toString("hex"), SCHOOL_PASSWORD_PEPPER: randomBytes(24).toString("hex") };
  const start = new Date(Date.now() - 86_400_000).toISOString();
  const end = new Date(Date.now() + 86_400_000).toISOString();
  sqlite.prepare("UPDATE tournaments SET name = ?, survey_start = ?, survey_end = ?").run("2026학년도 하반기 동부동락 학교스포츠클럽대회", start, end);
  const salt = randomBytes(16);
  const code = "동다99";
  const hash = pbkdf2Sync(code + env.SCHOOL_PASSWORD_PEPPER, salt, 1000, 32, "sha256").toString("base64url");
  sqlite.prepare("INSERT INTO schools (id,name,display_order,password_salt,password_hash,password_iterations) VALUES (?,?,?,?,?,?)").run("test-school", "검증중학교", 99, salt.toString("base64url"), hash, 1000);
  async function call(path, { method = "GET", body, rawBody, contentType = "application/json", cookie, origin = "https://test.example", headers = {} } = {}) {
    const response = await handleApi(new Request(`https://test.example/api/${path}`, { method, headers: { "Content-Type": contentType, Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(rawBody === undefined ? body === undefined ? {} : { body: JSON.stringify(body) } : { body: rawBody }) }), env);
    const data = response.headers.get("content-type")?.startsWith("image/") ? Buffer.from(await response.arrayBuffer()) : await response.json();
    return { status: response.status, data, cookie: response.headers.get("set-cookie")?.split(";")[0], headers: response.headers };
  }
  const admin = await call("admin/login", { method: "POST", body: { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD } });
  assert.equal(admin.status, 200);
  return { sqlite, call, cookie: admin.cookie, start, end, env };
}

test("logo images are admin-only, validated, versioned, and survive other settings updates", async () => {
  const { sqlite, call, cookie, start, end, env } = await fixture();
  try {
    const before = (await call("bootstrap")).data.tournament;
    const id = before.id;
    const path = `admin/events/${id}/logo`;
    const options = { method: "PUT", rawBody: logoPng(), contentType: "image/png", cookie };
    const school = await call("school/login", { method: "POST", body: { schoolId: "test-school", password: "ehdek99" } });
    assert.equal((await call("school/survey", { method: "PUT", cookie: school.cookie, body: { tournamentId: school.data.tournament.id, schoolId: school.data.school.id, revision: 0, noParticipation: false, selections: [{ divisionId: "division-basketball-male", teamCount: 1 }] } })).status, 200);
    const survey = (await call("school/session", { cookie: school.cookie })).data.survey;
    assert.equal(before.logoKey, "");
    for (const unprivileged of [undefined, school.cookie, "dongbu_admin_session=invalid"]) {
      assert.equal((await call(path, { ...options, cookie: unprivileged })).status, 401);
      assert.equal((await call(path, { method: "DELETE", cookie: unprivileged })).status, 401);
    }
    assert.equal((await call(path, { ...options, origin: "https://untrusted.example" })).status, 403);
    assert.equal(env.LOGO_FILES.writes, 0);
    assert.equal((await call("admin/events/missing/logo", options)).status, 404);
    assert.equal((await call(path, { ...options, contentType: "image/svg+xml" })).status, 415);
    for (const rawBody of [Buffer.alloc(0), Buffer.from("<svg/onload=alert(1)>"), logoPng().subarray(0, 40), Buffer.concat([logoPng(), Buffer.from("junk")]), logoPng(513)]) {
      assert.equal((await call(path, { ...options, rawBody })).status, 400);
    }
    for (const compressed of [Buffer.from([0]), deflateSync(Buffer.alloc(0)), deflateSync(Buffer.alloc(100)), deflateSync(Buffer.from([5, 0, 0, 0, 0]))]) {
      assert.equal((await call(path, { ...options, rawBody: logoPng(1, 1, compressed) })).status, 400);
    }
    const corrupt = logoPng(); corrupt[40] ^= 1;
    assert.equal((await call(path, { ...options, rawBody: corrupt })).status, 400);
    assert.equal((await call(path, { ...options, rawBody: Buffer.alloc(2 * 1024 * 1024 + 1) })).status, 413);
    assert.equal((await call(path, { ...options, headers: { "Content-Length": String(2 * 1024 * 1024 + 1) } })).status, 413);
    assert.equal(env.LOGO_FILES.writes, 0);
    const saved = await call(path, options);
    assert.equal(saved.status, 200);
    const key = saved.data.logoKey;
    assert.match(key, /^[a-f0-9-]{36}$/);
    const readPath = `events/${id}/logo/${key}`;
    const image = await call(readPath);
    assert.equal(image.status, 200);
    assert.deepEqual(image.data, logoPng());
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal(image.headers.get("x-content-type-options"), "nosniff");
    assert.match(image.headers.get("cache-control"), /private, no-store/);
    const after = (await call("bootstrap")).data.tournament;
    assert.deepEqual({ ...after, logoKey: "" }, before);
    assert.deepEqual((await call("school/session", { cookie: school.cookie })).data.survey, survey);
    await call(`admin/events/${id}/header-copy`, { method: "PATCH", cookie, body: { headerCopy: { logoText: "DB" } } });
    await call(`admin/events/${id}/card-copy`, { method: "PATCH", cookie, body: { cardCopy: { title: "유지" } } });
    await call(`admin/events/${id}`, { method: "PATCH", cookie, body: { academicYear: 2027, name: "변경된 대회", surveyStart: start, surveyEnd: end } });
    assert.equal((await call("bootstrap")).data.tournament.logoKey, key);
    // A public header must work before applications open and after they close.
    sqlite.prepare("UPDATE tournaments SET survey_start = ?, survey_end = ? WHERE id = ?").run("2099-01-01", "2099-02-01", id);
    assert.equal((await call(readPath)).status, 200);
    sqlite.prepare("UPDATE tournaments SET survey_start = ?, survey_end = ? WHERE id = ?").run("2020-01-01", "2020-02-01", id);
    assert.equal((await call(readPath)).status, 200);
    const replaced = await call(path, options);
    assert.equal(replaced.status, 200);
    assert.notEqual(replaced.data.logoKey, key);
    assert.equal((await call(readPath)).status, 404);
    assert.equal(env.LOGO_FILES.objects.size, 1);
    assert.equal((await call(path, { method: "DELETE", cookie, origin: "https://bad.example" })).status, 403);
    assert.equal((await call(path, { method: "DELETE", cookie })).status, 200);
    assert.equal((await call("bootstrap")).data.tournament.logoKey, "");
    assert.equal(env.LOGO_FILES.objects.size, 0);
    assert.equal((await call(path, { method: "DELETE", cookie })).status, 200);
    assert.equal(pageHeaderCopy((await call("bootstrap")).data.tournament).logoText, "DB");
  } finally { sqlite.close(); }
});

test("older Safari clients can upload raw canvas PNGs and only cleaned image bytes are stored", async () => {
  const { sqlite, call, cookie, env } = await fixture();
  try {
    // Synthetic 8×8 Safari canvas output, including its automatically-added eXIf.
    const raw = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAACKADAAQAAAABAAAACAAAAACVhHtSAAAALElEQVQYGWPUO7LtPwMSOLhuCRKPgYEJhYeFQ7kCxiib2w1YTIYLUW4FQRMAtrMGujNhN8QAAAAASUVORK5CYII=", "base64");
    const before = (await call("bootstrap")).data.tournament;
    const path = `admin/events/${before.id}/logo`;
    const school = await call("school/login", { method: "POST", body: { schoolId: "test-school", password: "ehdek99" } });
    assert.equal((await call("school/survey", { method: "PUT", cookie: school.cookie, body: { tournamentId: before.id, schoolId: school.data.school.id, revision: 0, noParticipation: false, selections: [{ divisionId: "division-basketball-male", teamCount: 1 }] } })).status, 200);
    const survey = (await call("school/session", { cookie: school.cookie })).data.survey;
    const schools = sqlite.prepare("SELECT * FROM schools ORDER BY id").all();
    const chunks = [];
    const types = [];
    for (let offset = 8; offset + 12 <= raw.length;) {
      const length = raw.readUInt32BE(offset);
      const type = raw.subarray(offset + 4, offset + 8).toString();
      types.push(type);
      if (type !== "eXIf") chunks.push(raw.subarray(offset, offset + length + 12));
      offset += length + 12;
    }
    assert.deepEqual(types, ["IHDR", "sRGB", "eXIf", "IDAT", "IEND"]);
    const expected = Buffer.concat([raw.subarray(0, 8), ...chunks]);
    const options = { method: "PUT", rawBody: raw, contentType: "image/png", cookie };
    const saved = await call(path, options);
    assert.equal(saved.status, 200);
    const image = await call(`events/${before.id}/logo/${saved.data.logoKey}`);
    assert.equal(image.status, 200);
    assert.deepEqual(image.data, expected, "pixels, alpha and color profile bytes must remain identical");
    assert.deepEqual(Buffer.from([...env.LOGO_FILES.objects.values()][0]), expected, "R2 stores sanitized bytes, not the original upload");
    assert.equal(Number(image.headers.get("content-length")), expected.length);
    const after = (await call("bootstrap")).data.tournament;
    assert.deepEqual({ ...after, logoKey: before.logoKey }, before);
    assert.deepEqual((await call("school/session", { cookie: school.cookie })).data.survey, survey);
    assert.deepEqual(sqlite.prepare("SELECT * FROM schools ORDER BY id").all(), schools);

    const corrupt = Buffer.from(raw); corrupt[60] ^= 1;
    assert.equal((await call(path, { ...options, rawBody: corrupt })).status, 400, "bad CRC in removed metadata still fails");
    assert.equal(env.LOGO_FILES.writes, 1);
    assert.equal((await call("bootstrap")).data.tournament.logoKey, saved.data.logoKey, "failed upload retains the saved logo");
  } finally { sqlite.close(); }
});

test("draft logos stay private and failed storage or database writes preserve the last logo", async () => {
  const { sqlite, call, cookie, start, end, env } = await fixture();
  try {
    const activeId = (await call("bootstrap")).data.tournament.id;
    const second = await call("admin/events", { method: "POST", cookie, body: { academicYear: 2027, name: "비공개 대회", surveyStart: start, surveyEnd: end } });
    const id = second.data.id;
    const path = `admin/events/${id}/logo`;
    const options = { method: "PUT", rawBody: logoPng(), contentType: "image/png", cookie };
    const key = (await call(path, options)).data.logoKey;
    const readPath = `events/${id}/logo/${key}`;
    const school = await call("school/login", { method: "POST", body: { schoolId: "test-school", password: "ehdek99" } });
    assert.equal((await call(readPath)).status, 401);
    assert.equal((await call(readPath, { cookie: school.cookie })).status, 401);
    assert.equal((await call(readPath, { cookie })).status, 200);
    assert.equal((await call(`events/${activeId}/logo/${key}`)).status, 404);
    env.LOGO_FILES.failPut = true;
    assert.equal((await call(path, options)).status, 503);
    env.LOGO_FILES.failPut = false;
    env.DB.failNextBatch = true;
    assert.equal((await call(path, options)).status, 503);
    assert.equal(env.LOGO_FILES.objects.size, 1);
    assert.equal((await call(readPath, { cookie })).status, 200);
    env.DB.failNextBatch = true;
    assert.equal((await call(path, { method: "DELETE", cookie })).status, 503);
    assert.equal((await call(readPath, { cookie })).status, 200);
    env.LOGO_FILES.failDelete = true;
    const replaced = await call(path, options);
    assert.equal(replaced.status, 200, "cleanup failure must not roll back a committed new logo");
    const newPath = `events/${id}/logo/${replaced.data.logoKey}`;
    assert.equal((await call(newPath, { cookie })).status, 200);
    assert.equal((await call(readPath, { cookie })).status, 404, "unreferenced objects are not retrievable");
    await call(`admin/events/${id}/activate`, { method: "POST", cookie, body: {} });
    assert.equal((await call(newPath)).status, 200);
    await call(`admin/events/${activeId}/activate`, { method: "POST", cookie, body: {} });
    assert.equal((await call(newPath)).status, 200, "a published non-default survey logo remains public");
    assert.equal((await call(`admin/events/${id}/unpublish`, { method: "POST", cookie, body: {} })).status, 200);
    assert.equal((await call(newPath)).status, 401);
    assert.equal((await call(newPath, { cookie: school.cookie })).status, 401);
    assert.equal((await call(newPath, { cookie })).status, 200, "administrators can still inspect an unpublished survey logo");
    sqlite.prepare("UPDATE admin_credentials SET auth_version = auth_version + 1").run();
    assert.equal((await call(newPath, { cookie })).status, 401);
    assert.equal((await call(path, options)).status, 401);
    assert.equal((await call(path, { method: "DELETE", cookie })).status, 401);
  } finally { sqlite.close(); }
});

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
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM schools WHERE school_level='middle'").get().n, 43);
  } finally { sqlite.close(); }
});

test("header defaults and validation preserve required branding and optional plain text", () => {
  assert.equal(pageHeaderCopy(null).logoText, "D");
  assert.equal(pageHeaderCopy(null).titlePrimary, "동부교육지원청 학교스포츠클럽대회");
  assert.equal(pageHeaderCopy(null).titleSecondary, "참가 신청");
  assert.equal(pageHeaderCopy({ headerCopy: "broken" }).eyebrow, "DONG-BU SCHOOL SPORTS");
  assert.equal(pageHeaderCopy({ headerCopy: '{"brandSubtitle":""}' }).brandSubtitle, "");
  assert.deepEqual(normalizePageHeaderCopy({ logoText: " 동부 ", brandName: "기관\n이름", titlePrimary: " 첫째\r\n둘째 ", academicYear: 2099 }), { logoText: "동부", brandName: "기관 이름", titlePrimary: "첫째\n둘째" });
  for (const field of PAGE_HEADER_FIELDS) assert.throws(() => normalizePageHeaderCopy({ [field.key]: "가".repeat(field.max + 1) }));
  for (const field of PAGE_HEADER_FIELDS.filter((field) => field.required)) assert.throws(() => normalizePageHeaderCopy({ [field.key]: "  " }));
  for (const value of [null, [], 123, { logoText: "D B" }, { brandName: 42 }]) assert.throws(() => normalizePageHeaderCopy(value));
  assert.equal(pageHeaderCopy(null, { titlePrimary: "" }).titlePrimary, "", "incomplete preview drafts remain visible to the editor");
});

test("header settings are admin-only and preserve other settings and submitted applications", async () => {
  const { sqlite, call, cookie, start, end } = await fixture();
  try {
    const boot = (await call("bootstrap")).data;
    const id = boot.tournament.id;
    assert.equal(boot.tournament.headerCopy, "{}");
    const path = `admin/events/${id}/header-copy`;
    const body = { headerCopy: { logoText: "동부", brandName: "새 교육지원청", brandSubtitle: "학교 체육", eyebrow: "NEW SCHOOL SPORTS", titlePrimary: "새 대회\n참가 안내", titleSecondary: "<script>text only</script>" } };
    const school = await call("school/login", { method: "POST", body: { schoolId: "test-school", password: "ehdek99" } });
    assert.equal(school.status, 200);
    assert.equal((await call("school/survey", { method: "PUT", cookie: school.cookie, body: { tournamentId: school.data.tournament.id, schoolId: school.data.school.id, revision: 0, noParticipation: false, selections: [{ divisionId: "division-basketball-male", teamCount: 1 }] } })).status, 200);
    const savedSurvey = (await call("school/session", { cookie: school.cookie })).data.survey;
    assert.equal((await call(path, { method: "PATCH", body })).status, 401);
    assert.equal((await call(path, { method: "PATCH", body, cookie: school.cookie })).status, 401);
    assert.equal((await call(path, { method: "PATCH", body, cookie, origin: "https://untrusted.example" })).status, 403);
    assert.equal((await call("admin/events/missing/header-copy", { method: "PATCH", body, cookie })).status, 404);
    for (const invalid of [null, {}, { headerCopy: null }, { headerCopy: [] }, { headerCopy: { titlePrimary: " " } }, { headerCopy: { logoText: "LONG" } }]) assert.equal((await call(path, { method: "PATCH", body: invalid, cookie })).status, 400);
    assert.equal((await call(path, { method: "PATCH", body, cookie })).status, 200);
    let latest = (await call("bootstrap")).data.tournament;
    assert.deepEqual(JSON.parse(latest.headerCopy), body.headerCopy);
    assert.equal(latest.academicYear, boot.tournament.academicYear);
    assert.equal(latest.surveyStart, start);
    assert.equal(latest.surveyEnd, end);
    assert.equal(latest.cardCopy, "{}");
    assert.deepEqual((await call("school/session", { cookie: school.cookie })).data.survey, savedSurvey);
    assert.deepEqual(JSON.parse((await call("school/session", { cookie: school.cookie })).data.tournament.headerCopy), body.headerCopy);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM admin_audit_logs WHERE entity_type = 'tournament_header'").get().n, 1);
    assert.deepEqual(JSON.parse((await call("admin/dashboard", { cookie })).data.selectedEvent.headerCopy), body.headerCopy);
    // Existing editors must never erase the separate header settings.
    assert.equal((await call(`admin/events/${id}/card-copy`, { method: "PATCH", cookie, body: { cardCopy: { title: "보존할 카드 제목" } } })).status, 200);
    assert.equal((await call(`admin/events/${id}`, { method: "PATCH", cookie, body: { academicYear: 2027, name: "변경된 대회", surveyStart: start, surveyEnd: end } })).status, 200);
    latest = (await call("bootstrap")).data.tournament;
    assert.deepEqual(JSON.parse(latest.headerCopy), body.headerCopy);
    assert.equal(latest.academicYear, 2027);
    const second = await call("admin/events", { method: "POST", cookie, body: { academicYear: 2028, name: "다른 대회", surveyStart: start, surveyEnd: end } });
    assert.equal(second.status, 201);
    const secondDashboard = (await call(`admin/dashboard?eventId=${second.data.id}`, { cookie })).data;
    assert.equal(secondDashboard.selectedEvent.headerCopy, "{}");
    assert.equal((await call(`admin/events/${second.data.id}/header-copy`, { method: "PATCH", cookie, body: { headerCopy: { logoText: "DB", titlePrimary: "다른 대회 제목" } } })).status, 200);
    assert.deepEqual(JSON.parse((await call("bootstrap")).data.tournament.headerCopy), body.headerCopy);
    assert.equal((await call(path, { method: "PATCH", cookie, body: { headerCopy: {} } })).status, 200);
    latest = (await call("bootstrap")).data.tournament;
    assert.equal(pageHeaderCopy(latest).logoText, "D");
    assert.equal(JSON.parse(latest.cardCopy).title, "보존할 카드 제목");
    assert.deepEqual((await call("school/session", { cookie: school.cookie })).data.survey, savedSurvey);
  } finally { sqlite.close(); }
});

test("teacher participant lists show only saved active entries in the session tournament", async () => {
  const { sqlite, call, cookie, start, end } = await fixture();
  try {
    assert.equal((await call("school/participants")).status, 401);
    assert.equal((await call("school/participants", { cookie })).status, 401);
    const school = await call("school/login", { method: "POST", body: { schoolId: "test-school", password: "ehdek99" } });
    const schoolCookie = school.cookie;
    const id = school.data.tournament.id;
    const get = async (query = "") => (await call(`school/participants${query}`, { cookie: schoolCookie })).data;
    let listed = await get();
    assert.equal(listed.tournamentId, id);
    assert.equal(listed.sports.length, 3);
    assert.ok(listed.sports.every((sport) => sport.schoolCount === 0 && sport.teamCount === 0));
    const save = await call("school/survey", { method: "PUT", cookie: schoolCookie, body: { tournamentId: id, schoolId: school.data.school.id, revision: 0, noParticipation: false, selections: [{ divisionId: "division-basketball-male", teamCount: 1 }, { divisionId: "division-basketball-female", teamCount: 1 }] } });
    assert.equal(save.status, 200);
    const others = sqlite.prepare("SELECT id FROM schools WHERE id <> 'test-school' AND school_level='middle' ORDER BY display_order LIMIT 3").all();
    sqlite.prepare("INSERT INTO responses (tournament_id, school_id, no_participation, revision) VALUES (?, ?, 0, 1)").run(id, others[0].id);
    sqlite.prepare("INSERT INTO response_items (tournament_id, school_id, division_id, team_count) VALUES (?, ?, 'division-basketball-male', 1)").run(id, others[0].id);
    // An inconsistent nonparticipation row and an orphan item are not public participants.
    sqlite.prepare("INSERT INTO responses (tournament_id, school_id, no_participation, revision) VALUES (?, ?, 1, 1)").run(id, others[1].id);
    for (const other of others.slice(1)) sqlite.prepare("INSERT INTO response_items (tournament_id, school_id, division_id, team_count) VALUES (?, ?, 'division-basketball-male', 1)").run(id, other.id);
    const basketball = (data) => data.sports.find((sport) => sport.name === "3x3 농구");
    listed = await get();
    const summary = basketball(listed);
    assert.equal(summary.schoolCount, 2, "both divisions in one school count as one school");
    assert.equal(summary.teamCount, 3);
    assert.deepEqual(summary.divisions.map((d) => [d.schoolCount, d.teamCount]), [[2, 2], [1, 1]]);
    assert.equal(summary.schools.find((s) => s.isOwnSchool).teamCount, 2);
    assert.equal(summary.schools.find((s) => s.isOwnSchool).schoolName, "검증중학교");
    assert.deepEqual(Object.keys(summary.schools[0]).sort(), ["isOwnSchool", "schoolId", "schoolName", "schoolLevel", "selections", "teamCount"].sort());
    assert.doesNotMatch(JSON.stringify(listed), /password|salt|pepper|revision|updatedAt|adminUsername|authVersion/i);
    const second = await call("admin/events", { method: "POST", cookie, body: { academicYear: 2027, name: "다른 대회", surveyStart: start, surveyEnd: end } });
    // New events start empty. Explicitly configure the independent participant fixture through the admin API.
    assert.equal((await call("admin/sports", { method: "POST", cookie, body: { eventId: second.data.id, name: "3x3 농구", divisions: [{ name: "남중부", schoolLevel: "middle" }, { name: "여중부", schoolLevel: "middle" }], maxTeamsPerSchool: 2, maxTeamsPerDivision: 1 } })).status, 201);
    const otherDivision = sqlite.prepare("SELECT d.id FROM divisions d JOIN sports s ON s.id = d.sport_id WHERE s.tournament_id = ? AND s.name = '3x3 농구' ORDER BY d.display_order LIMIT 1").get(second.data.id).id;
    // Seed a past saved response while the fixture survey is accepting entries,
    // then make it private to exercise participant isolation from a draft survey.
    sqlite.prepare("UPDATE tournaments SET status = 'active' WHERE id = ?").run(second.data.id);
    sqlite.prepare("INSERT INTO responses (tournament_id, school_id, no_participation, revision) VALUES (?, ?, 0, 1)").run(second.data.id, others[0].id);
    sqlite.prepare("INSERT INTO response_items (tournament_id, school_id, division_id, team_count) VALUES (?, ?, ?, 1)").run(second.data.id, others[0].id, otherDivision);
    sqlite.prepare("UPDATE tournaments SET status = 'draft' WHERE id = ?").run(second.data.id);
    assert.equal(basketball(await get(`?eventId=${second.data.id}`)).teamCount, 3, "the legacy eventId query cannot select another survey's participants");
    assert.equal((await get(`?eventId=${second.data.id}&schoolId=${others[0].id}`)).code, "SCHOOL_CHANGED");
    assert.equal((await get(`?tournamentId=${second.data.id}&schoolId=${school.data.school.id}`)).code, "EVENT_CHANGED");
    sqlite.prepare("UPDATE schools SET active = 0 WHERE id = ?").run(others[0].id);
    assert.equal(basketball(await get()).teamCount, 2);
    sqlite.prepare("UPDATE divisions SET active = 0 WHERE id = 'division-basketball-male'").run();
    assert.equal(basketball(await get()).teamCount, 1);
    assert.equal(basketball(await get()).divisions.length, 1);
    sqlite.prepare("UPDATE sports SET active = 0 WHERE name = '3x3 농구' AND tournament_id = ?").run(id);
    assert.equal((await get()).sports.some((sport) => sport.name === "3x3 농구"), false);
    sqlite.prepare("UPDATE schools SET active = 0 WHERE id = 'test-school'").run();
    assert.equal((await call("school/participants", { cookie: schoolCookie })).data.code, "SCHOOL_INACTIVE");
    sqlite.prepare("UPDATE schools SET active = 1 WHERE id = 'test-school'").run();
    sqlite.prepare("UPDATE tournaments SET survey_end = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), id);
    assert.equal((await call("school/participants", { cookie: schoolCookie })).status, 403);
    sqlite.prepare("UPDATE tournaments SET survey_end = ? WHERE id = ?").run(end, id);
    assert.equal((await call(`admin/events/${second.data.id}/activate`, { method: "POST", cookie, body: {} })).status, 200);
    assert.equal((await call("school/participants", { cookie: schoolCookie })).data.tournamentId, id, "publishing another survey preserves the existing session context");
    assert.equal((await call(`admin/events/${id}/unpublish`, { method: "POST", cookie, body: {} })).status, 200);
    assert.equal((await call("school/participants", { cookie: schoolCookie })).data.code, "SURVEY_CLOSED");
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
    const save = (selections, revision, noParticipation = false) => call("school/survey", { method: "PUT", cookie, body: { tournamentId: school.data.tournament.id, schoolId: school.data.school.id, selections, revision, noParticipation } });
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
