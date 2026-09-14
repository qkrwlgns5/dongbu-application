import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizeSchoolPasswordInput } from "../worker/school-password.js";

const root = new URL("../", import.meta.url);
const schoolManagementSource = (await readFile(new URL("app/admin-school-management.tsx", root), "utf8"))
  .replace('"react"', JSON.stringify(import.meta.resolve("react")))
  .replace('"./school-levels.js"', JSON.stringify(new URL("app/school-levels.js", root).href));
const schoolManagementCompiled = ts.transpileModule(schoolManagementSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
const schoolManagementUrl = `data:text/javascript;base64,${Buffer.from(schoolManagementCompiled).toString("base64")}`;

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
    .replace('"./admin-school-management"', JSON.stringify(schoolManagementUrl))
    .replace('"react"', JSON.stringify(import.meta.resolve("react")))
    .replace('"./event-card-copy.js"', JSON.stringify(new URL("app/event-card-copy.js", root).href))
    .replace('"./page-header-copy.js"', JSON.stringify(new URL("app/page-header-copy.js", root).href))
    .replace('"./logo-png.js"', JSON.stringify(new URL("app/logo-png.js", root).href))
    .replace('"./school-levels.js"', JSON.stringify(new URL("app/school-levels.js", root).href))
    .replace('"./sport-icons.js"', JSON.stringify(new URL("app/sport-icons.js", root).href));
  const compiled = ts.transpileModule(source + "\nexport { SchoolLogin, PageHeaderEditor, ApplicationIntro };", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
  const { SchoolLogin, PageHeaderEditor, ApplicationIntro } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  const tournament = { id: "preview", academicYear: 2027, name: "새 대회", headerCopy: "{}", cardCopy: "{}", surveyStart: "2026-09-13T15:00:00.000Z", surveyEnd: "2026-09-18T08:00:00.000Z", status: "active" };
  const bootstrap = { tournament, schools: [], sports: [], surveyState: { open: true, code: "OPEN", message: "" } };
  const renderLogin = () => renderToStaticMarkup(createElement(SchoolLogin, { bootstrap, onLogin() {} }));
  tournament.name = "동부학교스포츠클럽 후반기 대회";
  const defaults = renderLogin();
  assert.match(defaults, /<h2 data-long-title="true">/);
  const cardCss = await readFile(new URL("app/redesign.css", root), "utf8");
  assert.match(cardCss, /h2\[data-long-title="true"\]\s*\{\s*font-size: clamp\(22px, 2vw, 28px\)/);
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
  const preview = renderToStaticMarkup(createElement(PageHeaderEditor, { tournament, busy: false, async onSave() {}, async onSaveLogo() {} }));
  assert.match(preview, /메인페이지 상단 로고·제목/);
  assert.match(preview, /data-length="2"[^>]*>동부<\/span>/);
  assert.match(preview, /상단 로고·제목 저장/);
  assert.doesNotMatch(preview, /<h1\b/);
  assert.match(preview, /type="file"[^>]*accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(preview, /로고 이미지 저장/);
  assert.match(preview, /최대 10MB/);
  assert.doesNotMatch(preview, />이미지 삭제</);
  tournament.logoKey = "aefaf57d-b000-4000-8000-000000000001";
  const imageLogin = renderLogin();
  assert.match(imageLogin, /<img[^>]*class="brand-image"/);
  assert.match(imageLogin, /\/api\/events\/preview\/logo\/aefaf57d-b000-4000-8000-000000000001/);
  assert.doesNotMatch(imageLogin, /data-length="2"[^>]*>동부<\/span>/);
  const imagePreview = renderToStaticMarkup(createElement(PageHeaderEditor, { tournament, busy: false, async onSave() {}, async onSaveLogo() {} }));
  assert.match(imagePreview, />이미지 삭제</);
  assert.match(imagePreview, /현재 저장된 로고/);
  const updatedYear = renderToStaticMarkup(createElement(ApplicationIntro, { tournament: { ...tournament, academicYear: 2028 } }));
  assert.match(updatedYear, /2028학년도/);
  assert.doesNotMatch(updatedYear, /2027학년도/);
  const hidden = renderToStaticMarkup(createElement(ApplicationIntro, { tournament, copy: { titleSecondary: "", eyebrow: "" } }));
  assert.doesNotMatch(hidden, /intro-title-secondary|class="eyebrow"/);
});

async function brandingFixture() {
  const original = await readFile(new URL("app/survey-app-client.tsx", root), "utf8");
  let source = original.replace('"react"', JSON.stringify(import.meta.resolve("react")))
    .replace('"./admin-school-management"', JSON.stringify(schoolManagementUrl));
  for (const name of ["event-card-copy", "page-header-copy", "school-levels", "sport-icons", "logo-png"]) {
    source = source.replace(JSON.stringify(`./${name}.js`), JSON.stringify(new URL(`app/${name}.js`, root).href));
  }
  const compiled = ts.transpileModule(source + "\nexport { Brand, SchoolLogin, AdminLogin, AdminPanel };", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText.replace('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
  const components = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  const tournament = {
    id: "brand event/one", academicYear: 2027, name: "첫 번째 브랜드 대회", status: "active",
    surveyStart: "2027-01-01T00:00:00.000Z", surveyEnd: "2027-01-15T09:00:00.000Z",
    cardCopy: "{}", schoolLevels: '["middle"]', logoKey: "aefaf57d-b000-4000-8000-000000000001",
    headerCopy: JSON.stringify({ logoText: "DB", brandName: "새 기관명", brandSubtitle: "함께 뛰는 학교" }),
  };
  const renderComponent = (component, props) => renderToStaticMarkup(createElement(component, props));
  const brand = (html) => {
    const result = html.match(/<a\b[^>]*class="brand"[^>]*>[\s\S]*?<\/a>/)?.[0];
    assert.ok(result, "the rendered view contains a linked brand");
    return result;
  };
  return { ...components, original, tournament, renderComponent, brand };
}

test("administrator and teacher brands share the saved image, institution name, and subtitle with only navigation differing", async () => {
  const { Brand, tournament, renderComponent, brand } = await brandingFixture();
  const teacher = brand(renderComponent(Brand, { tournament }));
  const admin = brand(renderComponent(Brand, { tournament, admin: true }));
  const imagePath = "/api/events/brand%20event%2Fone/logo/aefaf57d-b000-4000-8000-000000000001";
  for (const html of [teacher, admin]) {
    assert.ok(html.includes(`src="${imagePath}"`), "the exact event-scoped saved image is displayed");
    assert.match(html, /<img[^>]*class="brand-image"/);
    assert.match(html, /새 기관명/);
    assert.match(html, /함께 뛰는 학교/);
    assert.doesNotMatch(html, /brand-mark|수요조사 관리|참가 신청 관리/);
  }
  assert.match(teacher, /href="\/"/);
  assert.match(admin, /href="\/admin"/);
  assert.equal(admin.replace('href="/admin"', 'href="/"'), teacher);
});

test("administrator branding preserves letter fallbacks, hidden subtitles, and escaped custom text", async () => {
  const { Brand, tournament, renderComponent, brand } = await brandingFixture();
  const hidden = { ...tournament, logoKey: "", headerCopy: JSON.stringify({ logoText: "동부", brandName: "문자 기관", brandSubtitle: "" }) };
  const teacher = brand(renderComponent(Brand, { tournament: hidden }));
  const admin = brand(renderComponent(Brand, { tournament: hidden, admin: true }));
  assert.equal(admin.replace('href="/admin"', 'href="/"'), teacher);
  assert.match(admin, /class="brand-mark"[^>]*data-length="2"[^>]*>동부<\/span>/);
  assert.doesNotMatch(admin, /<img\b|<b\b|수요조사 관리|참가 신청 관리/);
  const forcedFallback = brand(renderComponent(Brand, { tournament, admin: true, imageUrl: null }));
  assert.match(forcedFallback, /data-length="2"[^>]*>DB<\/span>/);
  assert.doesNotMatch(forcedFallback, /<img\b/);
  const malicious = { ...hidden, headerCopy: JSON.stringify({ logoText: "DB", brandName: '<script>alert("brand")</script>', brandSubtitle: '<img src=x onerror=alert(1)> & subtitle' }) };
  for (const adminMode of [false, true]) {
    const safe = brand(renderComponent(Brand, { tournament: malicious, admin: adminMode }));
    assert.match(safe, /&lt;script&gt;alert\(&quot;brand&quot;\)&lt;\/script&gt;/);
    assert.match(safe, /&lt;img src=x onerror=alert\(1\)&gt; &amp; subtitle/);
    assert.doesNotMatch(safe, /<(?:script|img)\b/);
  }
  const defaultTeacher = brand(renderComponent(Brand, { tournament: null }));
  const defaultAdmin = brand(renderComponent(Brand, { tournament: null, admin: true }));
  assert.equal(defaultAdmin.replace('href="/admin"', 'href="/"'), defaultTeacher);
  assert.match(defaultAdmin, /data-length="1"[^>]*>D<\/span>/);
  assert.match(defaultAdmin, /동부교육지원청/);
  assert.match(defaultAdmin, /학교스포츠클럽/);
});

test("administrator login and selected dashboard branding track public, switched, and refreshed tournament settings", async () => {
  const { Brand, SchoolLogin, AdminLogin, AdminPanel, original, tournament, renderComponent, brand } = await brandingFixture();
  const second = { ...tournament, id: "brand-two", name: "두 번째 브랜드 대회", logoKey: "", headerCopy: JSON.stringify({ logoText: "둘", brandName: "두 번째 기관", brandSubtitle: "두 번째 안내" }) };
  const dashboard = { adminUsername: "branding-test-admin", selectedEvent: tournament, events: [tournament, second], sports: [], rows: [] };
  const renderPanel = (selectedEvent) => renderComponent(AdminPanel, { dashboard: { ...dashboard, selectedEvent }, async refresh() {} });
  const bootstrap = { tournament, tournaments: [tournament], schools: [], sports: [], surveyState: { open: true, code: "OPEN", message: "" } };
  const schoolLogin = renderComponent(SchoolLogin, { bootstrap, onLogin() {} });
  const adminLogin = renderComponent(AdminLogin, { tournament, async onLogin() {} });
  const firstAdmin = brand(renderPanel(tournament));
  assert.equal(brand(adminLogin), firstAdmin);
  assert.equal(firstAdmin.replace('href="/admin"', 'href="/"'), brand(schoolLogin));
  assert.match(adminLogin, /관리자 로그인/);
  assert.match(adminLogin, /<input(?=[^>]*name="username")(?=[^>]*autoComplete="username")[^>]*>/);
  assert.match(adminLogin, /<input(?=[^>]*name="password")(?=[^>]*type="password")(?=[^>]*autoComplete="current-password")[^>]*>/);
  assert.match(adminLogin, /모든 관리 기능은 서버에서 권한을 다시 확인합니다/);
  const secondAdmin = brand(renderPanel(second));
  assert.equal(secondAdmin, brand(renderComponent(Brand, { tournament: second, admin: true })));
  assert.match(secondAdmin, /두 번째 기관/);
  assert.match(secondAdmin, /두 번째 안내/);
  assert.match(secondAdmin, /data-length="1"[^>]*>둘<\/span>/);
  assert.doesNotMatch(secondAdmin, /새 기관명|함께 뛰는 학교|brand-image/);
  const refreshed = { ...tournament, logoKey: "aefaf57d-b000-4000-8000-000000000002", headerCopy: JSON.stringify({ logoText: "DB", brandName: "저장 후 기관", brandSubtitle: "" }) };
  const refreshedAdmin = brand(renderPanel(refreshed));
  assert.equal(refreshedAdmin, brand(renderComponent(Brand, { tournament: refreshed, admin: true })));
  assert.match(refreshedAdmin, /저장 후 기관/);
  assert.match(refreshedAdmin, /logo\/aefaf57d-b000-4000-8000-000000000002/);
  assert.doesNotMatch(refreshedAdmin, /000000000001|새 기관명|함께 뛰는 학교|<b\b/);
  const fallback = brand(renderComponent(Brand, { tournament: null, admin: true }));
  assert.equal(brand(renderPanel(null)), fallback);
  assert.equal(brand(renderComponent(AdminLogin, { tournament: null, async onLogin() {} })), fallback);

  // Rendering checks props; these source guards also ensure the live parent
  // forwards fetched data and save handlers request fresh selected-event data.
  assert.match(original, /<AdminLogin\b[^>]*tournament=\{bootstrap\.tournament\}/);
  const loginSource = original.slice(original.indexOf("function AdminLogin("), original.indexOf("function AdminAccountSettings("));
  assert.match(loginSource, /<Brand\b[^>]*admin\b[^>]*tournament=\{tournament\}/);
  const panelSource = original.slice(original.indexOf("function AdminPanel("));
  assert.match(panelSource, /const selected = dashboard\.selectedEvent/);
  assert.match(panelSource, /<Brand\b[^>]*admin\b[^>]*tournament=\{selected\}/);
  const refreshSource = original.slice(original.indexOf("async function refreshDashboard("), original.indexOf("async function chooseTournament("));
  assert.match(refreshSource, /admin\/dashboard\$\{query\}/);
  assert.match(refreshSource, /setDashboard\(next\)/);
  assert.match(refreshSource, /setBootstrap\(boot\)/);
  const headerSaveSource = panelSource.slice(panelSource.indexOf("async function saveHeaderCopy("), panelSource.indexOf("async function saveLogoImage("));
  const logoSaveSource = panelSource.slice(panelSource.indexOf("async function saveLogoImage("), panelSource.indexOf("async function saveCardCopy("));
  assert.match(headerSaveSource, /await refresh\(selected\.id\)/);
  assert.match(logoSaveSource, /await refresh\(selected\.id\)/);
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
  assert.equal(normalizeSchoolPasswordInput("ehdek999"), "동다999");
  assert.equal(normalizeSchoolPasswordInput("ehdek99999"), "ehdek99999");
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
  assert.doesNotMatch(client, /<p className="team-limit">[^<]*복수 선택 가능/);
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

test("results table preserves horizontal scrolling without trapping vertical page gestures", async () => {
  const base = await readFile(new URL("app/globals.css", root), "utf8");
  const redesign = await readFile(new URL("app/redesign.css", root), "utf8");
  // Apply the matching declarations in the same order as layout.tsx. A later
  // two-axis `contain` must fail even if the earlier/base rule is correct.
  const computed = { x: "auto", y: "auto" };
  const rules = [...(base + "\n" + redesign).matchAll(/\.results-table-wrap\s*\{([^}]*)\}/gu)];
  assert.ok(rules.length > 0);
  for (const [, rule] of rules) {
    for (const declaration of rule.split(";")) {
      const [property, value] = declaration.split(":").map((part) => part.trim());
      if (property === "overscroll-behavior") {
        const [x, y = x] = value.split(/\s+/u);
        computed.x = x; computed.y = y;
      }
      if (["overscroll-behavior-x", "overscroll-behavior-inline"].includes(property)) computed.x = value;
      if (["overscroll-behavior-y", "overscroll-behavior-block"].includes(property)) computed.y = value;
      if (property === "touch-action") assert.ok(["auto", "manipulation", "pan-x pan-y pinch-zoom"].includes(value), "table must not disable vertical gestures or zoom");
    }
  }
  assert.deepEqual(computed, { x: "contain", y: "auto" });
  assert.match(base, /\.results-table-wrap\s*\{[^}]*overflow-x:\s*auto/u);
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

test("teacher participant viewing is independent of application edits and locks the modal background", async () => {
  const [client, css] = await Promise.all([readFile(new URL("app/survey-app-client.tsx", root), "utf8"), readFile(new URL("app/redesign.css", root), "utf8")]);
  assert.match(client, /api<ParticipantOverview>\(`school\/participants\?tournamentId=\$\{encodeURIComponent\(session.tournament.id\)\}&schoolId=\$\{encodeURIComponent\(session.school.id\)\}/);
  assert.match(client, /<ParticipantSportLink sport=\{sport\}/);
  assert.match(client, /type="button" className="participant-open-button"/);
  assert.match(client, /aria-controls="school-participants-dialog"/);
  assert.match(client, /element\?\.showModal\(\)/);
  assert.match(client, /position: "fixed", top: `-\$\{scrollY\}px`/);
  assert.match(client, /trigger\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(client, /controller\.abort\(\)/);
  assert.match(client, /저장 완료된 신청만 표시됩니다/);
  assert.match(css, /\.participant-dialog-list \{[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain/);
  assert.match(css, /\.participant-dialog-stats > div \{[^}]*justify-items: center/);
});

test("sport headings occupy the former badge column without moving the participation switch", async () => {
  const [client, css, baseCss] = await Promise.all([readFile(new URL("app/survey-app-client.tsx", root), "utf8"), readFile(new URL("app/redesign.css", root), "utf8"), readFile(new URL("app/globals.css", root), "utf8")]);
  // Decorative pictograms are now supported on administrator banners, while the
  // teacher form keeps its badge-free two-column heading and participation switch.
  const teacherHeader = client.match(/<header><div className="sport-name-block">[\s\S]*?<\/header>/)?.[0];
  assert.ok(teacherHeader);
  assert.doesNotMatch(teacherHeader, /SportSymbol|sport-symbol|>VB<|>BB<|>DB</);
  assert.match(client, /<header><div className="sport-name-block"><h2 title=\{sport\.name\}>\{sport\.name\}<\/h2><small lang="en">/);
  assert.match(client, /"VOLLEYBALL"/);
  assert.match(client, /"BASKETBALL"/);
  assert.match(client, /"DODGEBALL"/);
  assert.match(css, /\.sport-card > header \{[^}]*grid-template-columns: minmax\(0, 1fr\) 83px;/);
  assert.match(css, /\.sport-name-block \{[^}]*justify-items: start;[^}]*text-align: left;/);
});

test("new surveys explicitly choose school levels and preserve legacy middle-school defaults", async () => {
  const original = await readFile(new URL("app/survey-app-client.tsx", root), "utf8");
  let source = original.replace('"react"', JSON.stringify(import.meta.resolve("react"))).replace('"./admin-school-management"', JSON.stringify(schoolManagementUrl));
  for (const name of ["event-card-copy", "page-header-copy", "school-levels", "sport-icons", "logo-png"]) {
    source = source.replace(JSON.stringify("./" + name + ".js"), JSON.stringify(new URL("app/" + name + ".js", root).href));
  }
  const compiled = ts.transpileModule(source + "\nexport { SchoolLogin, NewSurveyForm, SportEditor, AdminPanel };", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText.replace('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
  const { SchoolLogin, NewSurveyForm, SportEditor, AdminPanel } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  const renderComponent = (component, props) => renderToStaticMarkup(createElement(component, props));
  const form = renderComponent(NewSurveyForm, { academicYear: 2027, start: "2027-01-01T09:00", end: "2027-01-15T18:00", busy: false, async onCreate() {} });
  assert.match(form, /<legend>참가 대상 학교/);
  assert.equal((form.match(/type="checkbox"/g) ?? []).length, 2);
  assert.match(form, /<input[^>]*type="checkbox"[^>]*name="schoolLevels"[^>]*value="elementary"/);
  assert.match(form, /<input[^>]*type="checkbox"[^>]*name="schoolLevels"[^>]*checked=""[^>]*value="middle"/);
  assert.doesNotMatch(form, /<input[^>]*checked=""[^>]*value="elementary"/);
  assert.match(form, /복수 선택 가능/);
  assert.match(form, /한 학교급 이상 선택/);
  assert.match(form, /\+ 새 대회 추가/);
  assert.match(original, /getAll\("schoolLevels"\)/);
  assert.match(original, /if \(!chosenLevels.length\)/);
  assert.match(original, /기존 신청을 보호하기 위해 참가 대상은 변경되지 않습니다/);
  assert.doesNotMatch(original, /42개교의 신청 현황/);
  const tournament = { id: "mixed-preview", academicYear: 2027, name: "다음 학년도 참가 신청", headerCopy: "{}", cardCopy: "{}", surveyStart: "2027-01-01T00:00:00.000Z", surveyEnd: "2027-01-15T09:00:00.000Z", status: "draft", schoolLevels: '["elementary","middle"]' };
  const schools = [
    { id: "preview-elementary", name: "예시초등학교", displayOrder: 1, schoolLevel: "elementary" },
    { id: "preview-middle", name: "예시중학교", displayOrder: 1, schoolLevel: "middle" },
  ];
  const bootstrap = { tournament, schools, sports: [], surveyState: { open: false, code: "ENDED", message: "기간 종료" } };
  const mixedLogin = renderComponent(SchoolLogin, { bootstrap, onLogin() {} });
  assert.match(mixedLogin, /aria-label="학교급 필터"/);
  assert.match(mixedLogin, /초등학교 순번 1/);
  assert.match(mixedLogin, /중학교 순번 1/);
  assert.match(mixedLogin, /동부 관내 초등학교·중학교/);
  assert.match(mixedLogin, /예시초등학교/);
  assert.match(mixedLogin, /예시중학교/);
  const legacyLogin = renderComponent(SchoolLogin, { bootstrap: { ...bootstrap, tournament: { ...tournament, schoolLevels: undefined }, schools: [schools[1]] }, onLogin() {} });
  assert.doesNotMatch(legacyLogin, /aria-label="학교급 필터"/);
  assert.match(legacyLogin, /동부 관내 중학교/);
  const sport = { id: "new", name: "", displayOrder: 0, teamCountEnabled: false, maxTeamsPerSchool: 2, maxTeamsPerDivision: 1, active: true, divisions: [] };
  const editor = renderComponent(SportEditor, { sport, levels: ["elementary", "middle"], isNew: true, busy: false, async onSave() {} });
  for (const name of ["남초부", "여초부", "남중부", "여중부"]) assert.match(editor, new RegExp('value="' + name + '"'));
  assert.equal((editor.match(/<select/g) ?? []).length, 4);
  assert.match(editor, /종별 1 학교급/);
  assert.match(editor, /value="elementary" selected=""/);
  assert.match(editor, /value="middle" selected=""/);
  const elementaryEditor = renderComponent(SportEditor, { sport, levels: ["elementary"], isNew: true, busy: false, async onSave() {} });
  assert.doesNotMatch(elementaryEditor, /<select|남중부|여중부/);
  assert.match(elementaryEditor, /남초부/);
  const dashboard = { adminUsername: "preview-admin", events: [tournament], selectedEvent: tournament, sports: [], rows: schools.map(school => ({ school, submitted: false, noParticipation: false, revision: 0, updatedAt: null, selections: [] })) };
  const admin = renderComponent(AdminPanel, { dashboard, async refresh() {} });
  assert.match(admin, /class="result-school-level">초등학교/);
  assert.doesNotMatch(admin, /class="result-school-level">중학교/);
  assert.match(admin, /role="tab"[^>]*id="response-tab-elementary"[^>]*aria-selected="true"/);
  assert.match(admin, /role="tab"[^>]*id="response-tab-middle"[^>]*aria-selected="false"/);
  assert.match(admin, /role="tabpanel"[^>]*aria-labelledby="response-tab-elementary"/);
  assert.match(admin, /초등학교·중학교/);
});

test("teacher survey selection and school-level response tabs preserve context and isolate rows", async () => {
  const original = await readFile(new URL("app/survey-app-client.tsx", root), "utf8");
  let source = original.replace('"react"', JSON.stringify(import.meta.resolve("react"))).replace('"./admin-school-management"', JSON.stringify(schoolManagementUrl));
  for (const name of ["event-card-copy", "page-header-copy", "school-levels", "sport-icons", "logo-png"]) source = source.replace(JSON.stringify(`./${name}.js`), JSON.stringify(new URL(`app/${name}.js`, root).href));
  const compiled = ts.transpileModule(source + "\nexport { SurveyPicker, AdminPanel };", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
  const { SurveyPicker, AdminPanel } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  const render = (component, props) => renderToStaticMarkup(createElement(component, props));
  const tournament = { id: "both", academicYear: 2027, name: "함께 대회", headerCopy: "{}", cardCopy: "{}", surveyStart: "2027-01-01T00:00:00Z", surveyEnd: "2027-01-15T09:00:00Z", status: "active", schoolLevels: '["elementary","middle"]', surveyState: { open: true, code: "OPEN", message: "진행 중" } };
  const second = { ...tournament, id: "second", name: "다른 대회", surveyState: { open: false, code: "NOT_STARTED", message: "시작 전" } };
  const bootstrap = { tournament, tournaments: [tournament, second], schools: [], sports: [], surveyState: tournament.surveyState };
  const picker = render(SurveyPicker, { bootstrap, busy: false });
  assert.match(picker, /참가신청할 대회를 선택해 주세요/);
  assert.match(picker, /<span>대회 선택<\/span>/);
  assert.match(picker, /value="both" selected=""/);
  assert.match(picker, /다른 대회 · 시작 전/);
  assert.match(picker, /초등학교·중학교/);
  assert.equal(render(SurveyPicker, { bootstrap: { ...bootstrap, tournaments: [tournament] }, busy: false }), "");
  assert.match(render(SurveyPicker, { bootstrap, busy: true }), /<select[^>]*disabled=""/);
  const sports = [{ id: "sport", name: "배구", active: true, maxTeamsPerSchool: 2, maxTeamsPerDivision: 1, divisions: [{ id: "e", name: "남초부", schoolLevel: "elementary" }, { id: "m", name: "남중부", schoolLevel: "middle" }] }];
  const rows = [{ school: { id: "e", name: "초등행학교", schoolLevel: "elementary", displayOrder: 1 }, submitted: true, noParticipation: false, selections: [{ divisionId: "e", teamCount: 1 }] }, { school: { id: "m", name: "중등행학교", schoolLevel: "middle", displayOrder: 1 }, submitted: false, selections: [] }];
  const dashboard = { adminUsername: "test-admin", selectedEvent: tournament, events: [tournament], sports, rows };
  const admin = render(AdminPanel, { dashboard, async refresh() {} });
  const table = admin.match(/<table>[\s\S]*?<\/table>/)?.[0];
  assert.ok(table); assert.match(table, /초등행학교/); assert.match(table, /남초부/); assert.doesNotMatch(table, /중등행학교|남중부/);
  assert.match(admin, /초등학교 · 1 \/ 1개교 신청/);
  const middleAdmin = render(AdminPanel, { dashboard: { ...dashboard, selectedEvent: { ...tournament, schoolLevels: '["middle"]' } }, async refresh() {} });
  const middleTable = middleAdmin.match(/<table>[\s\S]*?<\/table>/)?.[0];
  assert.match(middleTable, /중등행학교/); assert.match(middleTable, /남중부/); assert.doesNotMatch(middleTable, /초등행학교|남초부/);
  assert.match(original, /tournamentId: session.tournament.id,\s*schoolId: session.school.id,/);
  assert.match(original, /다른 대회 선택/); assert.match(original, /공개 대회 목록으로 돌아가기/);
});
