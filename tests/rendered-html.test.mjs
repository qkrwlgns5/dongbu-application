import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeSchoolPasswordInput } from "../worker/school-password.js";

const root = new URL("../", import.meta.url);

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the school participation application shell", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  const html = await response.text();
  assert.match(html, /<html[^>]*lang="ko"/i);
  assert.match(html, /동부교육지원청 학교스포츠클럽대회 참가 신청/);
  assert.match(html, new RegExp("/og-application\\.png"));
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("server-renders a no-index administrator route", async () => {
  const response = await render("/admin");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /관리자 · 동부학교스포츠클럽 참가 신청/);
  assert.match(html, /<meta[^>]+name="robots"[^>]+content="noindex, nofollow"/i);
});

test("keeps credentials and starter files out of committed source", async () => {
  const [client, seed, ignore] = await Promise.all([
    readFile(new URL("app/survey-app-client.tsx", root), "utf8"),
    readFile(new URL("drizzle/0002_seed_initial_survey.sql", root), "utf8"),
    readFile(new URL(".gitignore", root), "utf8"),
  ]);
  assert.doesNotMatch(client, /동다0[1-9]|동더0[1-2]/u);
  assert.doesNotMatch(seed, /동다0[1-9]|동더0[1-2]/u);
  assert.match(ignore, /^\.dev\.vars$/m);
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", root)));
  await assert.rejects(access(new URL("public/og.png", root)));
});

test("uses reliable route links and the revised two-line application title", async () => {
  const client = await readFile(new URL("app/survey-app-client.tsx", root), "utf8");
  assert.doesNotMatch(client, /from ["']next\/link["']/);
  assert.match(client, /<a className="admin-link" href="\/admin">관리자<\/a>/);
  assert.match(client, /<span className="academic-year-badge">\{bootstrap\.tournament\.academicYear\}학년도<\/span>/);
  assert.match(client, /<span className="intro-title-primary">동부교육지원청 학교스포츠클럽대회<\/span>/);
  assert.match(client, /<span className="intro-title-secondary">참가 신청<\/span>/);
  assert.match(client, /<strong title=\{bootstrap\.tournament\?\.name \?\? "대회 준비 중"\}>/);
  assert.match(client, /className="school-name">\{school\.name\}<\/span>/);
  assert.match(client, /<b title=\{selectedName\}>\{selectedName\}<\/b>/);
  assert.match(client, /aria-checked=\{selected\} title=\{division\.name\}/);
  assert.match(client, /<p className="eyebrow" lang="en"><span aria-hidden="true" \/> DONG-BU SCHOOL SPORTS<\/p>/);
  assert.doesNotMatch(client, /academicYear \?\? ""\} DONG-BU SCHOOL SPORTS/);
});

test("provides protected sport editing and deletion controls", async () => {
  const [client, api] = await Promise.all([
    readFile(new URL("app/survey-app-client.tsx", root), "utf8"),
    readFile(new URL("worker/api.ts", root), "utf8"),
  ]);
  assert.match(client, /function SportEditor/);
  assert.match(client, /method: "PATCH"/);
  assert.match(client, /method: "DELETE"/);
  assert.match(client, /학교 전체 최대 팀 수/);
  assert.match(client, /한 종별 최대 팀 수/);
  assert.doesNotMatch(client, /종별로 참가팀 수 입력 사용/);
  assert.match(client, /\+ 종별 추가/);
  assert.match(client, /window\.confirm/);
  assert.match(api, /async function updateSport/);
  assert.match(api, /async function deleteSport/);
  assert.match(api, /DIVISION_IN_USE/);
  assert.match(api, /SPORT_IN_USE/);
  assert.match(api, /request\.method === "PATCH"\) return await updateSport/);
  assert.match(api, /request\.method === "DELETE"\) return await deleteSport/);
});

test("accepts Korean school codes entered with an English keyboard layout", async () => {
  assert.equal(normalizeSchoolPasswordInput("ehdek99"), "동다99");
  assert.equal(normalizeSchoolPasswordInput("EHDEJ98"), "동더98");
  assert.equal(normalizeSchoolPasswordInput(" 동다99 "), "동다99");
  assert.equal(normalizeSchoolPasswordInput("ehdek999"), "ehdek999");
  assert.equal(normalizeSchoolPasswordInput("not-a-school-code"), "not-a-school-code");
  const api = await readFile(new URL("worker/api.ts", root), "utf8");
  assert.match(api, /const password = normalizeSchoolPasswordInput\(body\.password\)/);
});

test("separates school-wide and per-division team limits in the application UI", async () => {
  const [client, api, migration, guardMigration] = await Promise.all([
    readFile(new URL("app/survey-app-client.tsx", root), "utf8"),
    readFile(new URL("worker/api.ts", root), "utf8"),
    readFile(new URL("drizzle/0004_new_moon_knight.sql", root), "utf8"),
    readFile(new URL("drizzle/0005_team_limit_guards.sql", root), "utf8"),
  ]);
  assert.match(client, /const showTeamCountControl = selected && \(sport\.maxTeamsPerDivision >= 2 \|\| currentCount > sport\.maxTeamsPerDivision\)/);
  assert.match(client, /showTeamCountControl && <label><span>참가팀 수<\/span>/);
  assert.match(client, /sport\.maxTeamsPerSchool - otherDivisionTotal/);
  assert.match(client, /length: selectableMaximum/);
  assert.match(client, /<p className="team-limit">/);
  assert.match(client, /학교 전체 최대/);
  assert.match(client, /한 종별 최대/);
  assert.match(client, /`전체 \$\{sport\.maxTeamsPerSchool\}팀 · 종별 \$\{sport\.maxTeamsPerDivision\}팀`/);
  assert.doesNotMatch(client, /복수 선택 가능/);
  assert.match(api, /max_teams_per_division AS maxTeamsPerDivision/);
  assert.match(api, /validateTeamSelection/);
  assert.match(api, /MAX_TEAMS_PER_DIVISION_IN_USE/);
  assert.match(migration, /ADD `max_teams_per_division`/);
  assert.match(migration, /WHERE `name` = '3x3 농구'/);
  assert.match(guardMigration, /CREATE TRIGGER `sports_validate_team_limits_update`/);
  assert.match(guardMigration, /CREATE TRIGGER `response_items_validate_team_limits_insert`/);
  assert.match(guardMigration, /RAISE\(ABORT, 'MAX_TEAMS_PER_DIVISION_IN_USE'\)/);
  assert.match(guardMigration, /RAISE\(ABORT, 'SCHOOL_TEAM_LIMIT_EXCEEDED'\)/);
  assert.match(api, /TEAM_LIMIT_CHANGED/);
});

test("lets an authenticated administrator securely change login credentials", async () => {
  const [client, apiSource, migration] = await Promise.all([
    readFile(new URL("app/survey-app-client.tsx", root), "utf8"),
    readFile(new URL("worker/api.ts", root), "utf8"),
    readFile(new URL("drizzle/0003_admin_credentials.sql", root), "utf8"),
  ]);

  assert.match(client, /계정 설정/);
  assert.match(client, /function AdminAccountSettings/);
  assert.match(client, /현재 비밀번호/);
  assert.match(client, /새 비밀번호 확인/);
  assert.match(client, /method: "PATCH"/);
  assert.match(client, /admin\/credentials/);
  assert.match(client, /accountChanged=1/);
  assert.match(client, /모든 관리자 기기에서 로그아웃/);

  assert.match(apiSource, /ADMIN_PASSWORD_ITERATIONS = 100_000/);
  assert.match(apiSource, /PBKDF2/);
  assert.match(apiSource, /pbkdf2-sha256-admin-v1/);
  assert.match(apiSource, /async function updateAdminCredentials/);
  assert.match(apiSource, /DELETE FROM sessions WHERE actor_type = 'admin'/);
  assert.match(apiSource, /path === "admin\/credentials"/);
  assert.match(apiSource, /auth_version = auth_version \+ 1/);

  assert.match(migration, /CREATE TABLE `admin_credentials`/);
  assert.match(migration, /`password_hash` text NOT NULL/);
  assert.match(migration, /`admin_auth_version` integer/);
  assert.doesNotMatch(migration, /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+`?admin_credentials`?/iu);
});

test("summarizes division teams and opens a scroll-locked participant dialog", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("app/survey-app-client.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(client, /const \[selectedDivision, setSelectedDivision\]/);
  assert.match(client, /const divisionMetrics = sport\.divisions\.map/);
  assert.match(client, /aria-haspopup="dialog"/);
  assert.match(client, /aria-controls="division-participants-dialog"/);
  assert.match(client, /role="dialog" aria-modal="true"/);
  assert.match(client, /root\.style\.overflow = "hidden"/);
  assert.match(client, /body\.style\.position = "fixed"/);
  assert.match(client, /window\.scrollTo\(0, scrollY\)/);
  assert.match(client, /className="division-participant-list"/);
  assert.match(client, /focus\(\{ preventScroll: true \}\)/);

  assert.match(styles, /\.results-panel table \{[^}]*font-size: 12px/s);
  assert.match(styles, /\.results-panel td:nth-child\(2\) b \{[^}]*font-size: 13px/s);
  assert.match(styles, /\.division-participant-list \{[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain/s);
});

test("uses Korean-aware wrapping and keeps compact UI tokens together", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("app/survey-app-client.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(styles, /html \{[^}]*line-break: strict/s);
  assert.match(styles, /body \{[^}]*word-break: keep-all/s);
  assert.doesNotMatch(styles, /body \{[^}]*overflow-wrap: anywhere/s);
  assert.match(styles, /\.form-error,[\s\S]*?\.center-state small \{[^}]*overflow-wrap: anywhere/s);
  assert.match(styles, /\.sport-metric-title > span \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap/s);
  assert.match(styles, /\.results-panel th \{[^}]*vertical-align: middle;[^}]*white-space: nowrap/s);
  assert.match(styles, /\.intro-title-primary \{[^}]*white-space: nowrap/s);
  assert.match(styles, /\.period-line \{[^}]*flex-wrap: wrap/s);
  assert.match(styles, /\.center-state b, \.center-state small \{[^}]*max-width: 100%/s);
  assert.match(styles, /\.center-state small \{[^}]*overflow-wrap: anywhere/s);
  assert.match(styles, /\.admin-topbar > div:last-child \{[^}]*flex-wrap: wrap/s);
  assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*?\.admin-settings-grid \{ grid-template-columns: 1fr; \}/s);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*?\.sport-division-metrics \{ grid-template-columns: 1fr; \}/s);
  assert.match(styles, /@media \(max-width: 390px\)[\s\S]*?\.export-controls \{ grid-template-columns: 1fr; \}/s);
  assert.match(styles, /\.team-limit-field-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /\.option-head \{[^}]*flex-wrap: nowrap/s);
  assert.match(styles, /\.team-limit \{[^}]*flex-wrap: nowrap/s);
  assert.doesNotMatch(styles, /\.intro-copy > p br \{ display: none; \}/);

  assert.match(client, /className="intro-description"/);
  assert.match(client, /className="period-date"/);
  assert.match(client, /className="school-name"/);
  assert.match(client, /className="team-limit-maximum"/);
  assert.match(client, /className="survey-error-message"/);
  assert.match(client, /className="dashboard-meta"/);
  assert.match(client, /className="sport-division-name"/);
});
