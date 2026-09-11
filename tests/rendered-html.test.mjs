import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
  assert.match(client, /<span className="academic-year-badge">\{tournament\.academicYear\}학년도<\/span>/);
  assert.match(client, /<ApplicationIntro tournament=\{bootstrap\.tournament\} \/>/);
  assert.match(client, /<span className="intro-title-primary"><CardText text=\{content\.titlePrimary\} \/><\/span>/);
  assert.match(client, /<span className="intro-title-secondary"><CardText text=\{content\.titleSecondary\} \/><\/span>/);
  assert.match(client, /<EventCard tournament=\{bootstrap\.tournament\} sports=\{bootstrap\.sports\} schoolCount=\{bootstrap\.schools\.length\}/);
  assert.match(client, /className="school-name">\{school\.name\}<\/span>/);
  assert.match(client, /<b title=\{selectedName\}>✓ \{selectedName\}<\/b>/);
  assert.match(client, /aria-checked=\{selected\} title=\{division\.name\}/);
  assert.match(client, /<p className="eyebrow">\{content\.eyebrow\}<\/p>/);
  assert.doesNotMatch(client, /academicYear \?\? ""\} DONG-BU SCHOOL SPORTS/);
});

test("renders saved main-page branding safely with a linked year badge and matching admin preview", async () => {
  const source = (await readFile(new URL("app/survey-app-client.tsx", root), "utf8"))
    .replace('"react"', JSON.stringify(import.meta.resolve("react")))
    .replace('"./event-card-copy.js"', JSON.stringify(new URL("app/event-card-copy.js", root).href))
    .replace('"./page-header-copy.js"', JSON.stringify(new URL("app/page-header-copy.js", root).href));
  const compiled = ts.transpileModule(source + "\nexport { SchoolLogin, PageHeaderEditor, ApplicationIntro };", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
  const { SchoolLogin, PageHeaderEditor, ApplicationIntro } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  const tournament = { id: "preview", academicYear: 2027, name: "새 대회", headerCopy: "{}", cardCopy: "{}", surveyStart: "2026-09-13T15:00:00.000Z", surveyEnd: "2026-09-18T08:00:00.000Z", status: "active" };
  const bootstrap = { tournament, schools: [], sports: [], surveyState: { open: true, code: "OPEN", message: "" } };
  const renderLogin = () => renderToStaticMarkup(createElement(SchoolLogin, { bootstrap, onLogin() {} }));
  const defaults = renderLogin();
  assert.match(defaults, /data-length="1"[^>]*>D<\/span>/);
  assert.match(defaults, /동부교육지원청 학교스포츠클럽대회/);
  assert.match(defaults, /DONG-BU SCHOOL SPORTS/);
  assert.match(defaults, /09\.14\.\(월\) 00:00/);
  assert.match(defaults, /~ 09\.18\.\(금\) 17:00/);
  assert.doesNotMatch(defaults, /한국시간 기준/);
  tournament.headerCopy = JSON.stringify({ logoText: "동부", brandName: "새 교육지원청", brandSubtitle: "새 스포츠", eyebrow: "NEW SPORTS", titlePrimary: "첫 문장.\n둘째 문장.", titleSecondary: "<script>alert(1)</script>" });
  const changed = renderLogin();
  assert.match(changed, /data-length="2"[^>]*>동부<\/span>/);
  assert.match(changed, /새 교육지원청/);
  assert.match(changed, /새 스포츠/);
  assert.match(changed, /NEW SPORTS/);
  assert.match(changed, /2027학년도/);
  assert.match(changed, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(changed, /<script>alert/);
  assert.equal((changed.match(/<h1\b/g) ?? []).length, 1);
  const preview = renderToStaticMarkup(createElement(PageHeaderEditor, { tournament, busy: false, async onSave() {} }));
  assert.match(preview, /메인페이지 상단 로고·제목/);
  assert.match(preview, /data-length="2"[^>]*>동부<\/span>/);
  assert.match(preview, /상단 로고·제목 저장/);
  assert.doesNotMatch(preview, /<h1\b/);
  const updatedYear = renderToStaticMarkup(createElement(ApplicationIntro, { tournament: { ...tournament, academicYear: 2028 } }));
  assert.match(updatedYear, /2028학년도/);
  assert.doesNotMatch(updatedYear, /2027학년도/);
  const hidden = renderToStaticMarkup(createElement(ApplicationIntro, { tournament, copy: { titleSecondary: "", eyebrow: "" } }));
  assert.doesNotMatch(hidden, /intro-title-secondary|class="eyebrow"/);
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
  assert.match(client, /showTeamCountControl && \(sport\.maxTeamsPerDivision <= 3 && !currentNeedsCorrection/);
  assert.match(client, /className="division-teams" role="group"/);
  assert.match(client, /<label><span>참가팀 수<\/span><select aria-label=/);
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
  const [client, originalStyles, redesignStyles] = await Promise.all([
    readFile(new URL("app/survey-app-client.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/redesign.css", root), "utf8"),
  ]);
  const styles = originalStyles + redesignStyles;

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

  assert.match(redesignStyles, /\.results-panel table \{[^}]*font-size: 14px/s);
  assert.match(redesignStyles, /\.results-panel td:nth-child\(2\) b \{[^}]*font-size: 15px/s);
  assert.match(styles, /\.division-participant-list \{[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain/s);
});

test("self-hosts and globally applies the requested NanumSquareRound OTF ExtraBold font", async () => {
  const [styles, font] = await Promise.all([
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("public/fonts/NanumSquareRoundOTFEB.otf", root)),
  ]);

  assert.match(styles, /@font-face \{[^}]*font-family: "NanumSquareRoundOTFEB";[^}]*url\("\/fonts\/NanumSquareRoundOTFEB\.otf"\) format\("opentype"\);[^}]*font-weight: 800;[^}]*font-display: swap;/s);
  assert.match(styles, /html \{[^}]*font-family: var\(--font-ui\);[^}]*font-synthesis: none;/s);
  assert.match(styles, /body \{[^}]*font-family: inherit;[^}]*font-weight: 800;/s);
  assert.match(styles, /button, input, select, textarea, option, optgroup \{ font: inherit; \}/);
  assert.doesNotMatch(styles, /Pretendard/);
  assert.equal(font.byteLength, 432_680);
  assert.equal(createHash("sha256").update(font).digest("hex"), "c1e41280f9e586f2b2a1c934d2bcec730049ffd5d8d721a86a24456017fb0905");
});

test("uses Korean-aware wrapping and keeps compact UI tokens together", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("app/survey-app-client.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(styles, /html \{[^}]*line-break: strict;[^}]*word-break: keep-all;[^}]*overflow-wrap: break-word;[^}]*text-wrap: pretty;/s);
  assert.match(styles, /body \{[^}]*word-break: keep-all;[^}]*overflow-wrap: break-word;/s);
  assert.doesNotMatch(styles, /overflow-wrap: anywhere/);
  assert.match(styles, /\.form-error,[\s\S]*?\.center-state small \{[^}]*overflow-wrap: break-word/s);
  assert.match(styles, /\.sentence-unit \{[^}]*display: inline-block;[^}]*inline-size: max-content;[^}]*max-inline-size: 100%;/s);
  assert.match(styles, /\.sport-metric-title > span \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap/s);
  assert.match(styles, /\.results-panel th \{[^}]*vertical-align: middle;[^}]*white-space: nowrap/s);
  assert.match(styles, /\.intro-title-primary \{[^}]*max-width: 100%;/s);
  assert.doesNotMatch(styles, /\.intro-title-primary \{[^}]*white-space: nowrap/s);
  assert.doesNotMatch(styles, /\.survey-hero h1 > span \{[^}]*white-space: nowrap/s);
  assert.doesNotMatch(styles, /\.admin-login-title > span \{[^}]*white-space: nowrap/s);
  assert.match(styles, /\.period-line \{[^}]*flex-wrap: wrap/s);
  assert.match(styles, /\.center-state b, \.center-state small \{[^}]*max-width: 100%/s);
  assert.match(styles, /\.admin-topbar > div:last-child \{[^}]*flex-wrap: wrap/s);
  assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*?\.admin-settings-grid \{ grid-template-columns: 1fr; \}/s);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*?\.sport-division-metrics \{ grid-template-columns: 1fr; \}/s);
  assert.match(styles, /@media \(max-width: 390px\)[\s\S]*?\.export-controls \{ grid-template-columns: 1fr; \}/s);
  assert.match(styles, /\.team-limit-field-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /\.option-head \{[^}]*flex-wrap: nowrap/s);
  assert.match(styles, /\.team-limit \{[^}]*flex-wrap: nowrap/s);
  assert.doesNotMatch(styles, /\.intro-copy > p br \{ display: none; \}/);

  assert.match(client, /function CardText/);
  assert.match(client, /className="period-date"/);
  assert.match(client, /className="school-name"/);
  assert.match(client, /className="team-limit-maximum"/);
  assert.match(client, /className="survey-error-message"/);
  assert.match(client, /className="dashboard-meta"/);
  assert.match(client, /className="sport-division-name"/);
  assert.match(client, /function SentenceFlow/);
  assert.match(client, /new Intl\.Segmenter\("ko", \{ granularity: "sentence" \}\)/);
  assert.match(client, /<SentenceFlow text=\{error\} \/>/);
  assert.match(client, /<SentenceFlow text=\{notice\} \/>/);
  assert.match(client, /className="card-copy-line"/);
  assert.match(client, /<CardText text=\{content\.title\} \/>/);
  assert.match(client, /<CardText text=\{content\.description\} \/>/);
  assert.match(client, /<p className="prose-copy">\s*<span className="sentence-unit">관리자 아이디와 비밀번호를 변경할 수 있습니다\.<\/span>/s);
});
