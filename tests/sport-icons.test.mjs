import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SPORT_ICONS, normalizeSportIconKey, resolveSportIcon } from "../app/sport-icons.js";

const root = new URL("../", import.meta.url);
const expectedKeys = [
  "basketball-3x3", "netball", "basketball", "volleyball", "badminton", "sport-stacking",
  "baseball", "athletics", "jokgu", "jump-rope", "football", "cheerleading", "kinball",
  "table-tennis", "teeball", "futsal", "flying-disc", "floorball", "dodgeball", "generic",
];
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replace('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(compile(source)).toString("base64")}`;
const registry = (await readFile(new URL("app/admin-school-management.tsx", root), "utf8"))
  .replace('"react"', JSON.stringify(import.meta.resolve("react")))
  .replace('"./school-levels.js"', JSON.stringify(new URL("app/school-levels.js", root).href));
const original = await readFile(new URL("app/survey-app-client.tsx", root), "utf8");
let client = original.replace('"react"', JSON.stringify(import.meta.resolve("react")))
  .replace('"./admin-school-management"', JSON.stringify(moduleUrl(registry)));
for (const name of ["event-card-copy", "page-header-copy", "school-levels", "sport-icons"]) {
  client = client.replace(JSON.stringify("./" + name + ".js"), JSON.stringify(new URL("app/" + name + ".js", root).href));
}
const { SportIconPicker, SportSymbol, SportEditor, AdminPanel } = await import(moduleUrl(
  client + "\nexport { SportIconPicker, SportSymbol, SportEditor, AdminPanel };",
));
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const inputs = (html) => html.match(/<input\b[^>]*type="radio"[^>]*>/g) ?? [];
const checked = (html) => inputs(html).filter(input => /\bchecked=""/.test(input)).map(input => input.match(/\bvalue="([^"]+)"/)?.[1]);
const tournament = {
  id: "icon-preview", academicYear: 2027, name: "종목 그림 검증", headerCopy: "{}", cardCopy: "{}",
  surveyStart: "2027-01-01T00:00:00.000Z", surveyEnd: "2027-01-15T09:00:00.000Z",
  status: "draft", schoolLevels: '["middle"]',
};
const sport = {
  id: "stored-netball", name: "이름을 수정한 종목", iconKey: "netball", displayOrder: 1,
  teamCountEnabled: false, maxTeamsPerSchool: 2, maxTeamsPerDivision: 1, active: true,
  divisions: [{ id: "netball-boys", name: "남중부", schoolLevel: "middle", displayOrder: 1 }],
};
const dashboard = { adminUsername: "preview-admin", events: [tournament], selectedEvent: tournament, sports: [sport], rows: [] };

test("the complete sport catalog uses distinct, self-hosted, script-free SVG illustrations", async () => {
  assert.deepEqual(SPORT_ICONS.map(icon => icon.key), expectedKeys);
  assert.equal(new Set(SPORT_ICONS.map(icon => icon.src)).size, 20);
  const bodies = [];
  for (const icon of SPORT_ICONS) {
    assert.ok(icon.label && icon.englishName);
    assert.equal(icon.src, "/sport-icons/" + icon.key + ".svg");
    const svg = await readFile(new URL("public" + icon.src, root), "utf8");
    assert.match(svg, /<svg\b[^>]*viewBox=/);
    assert.match(svg, /<\/svg>\s*$/);
    assert.doesNotMatch(svg, /<(?:script|foreignObject|iframe|image)\b|\bon\w+\s*=|\b(?:href|xlink:href)\s*=\s*["'](?:https?:|data:|javascript:)|@import|url\s*\(\s*["']?https?:/i);
    bodies.push(svg);
  }
  assert.equal(new Set(bodies).size, 20, "each sport has an individual local drawing");
});

test("automatic icons follow Korean and English names while explicit choices stay fixed and unknown names stay safe", () => {
  for (const icon of SPORT_ICONS.filter(icon => icon.key !== "generic")) {
    assert.equal(resolveSportIcon("auto", icon.label).key, icon.key);
    assert.equal(resolveSportIcon(icon.key, "완전히 다른 종목명").key, icon.key);
    assert.equal(normalizeSportIconKey(icon.key), icon.key);
  }
  for (const name of ["3x3 농구", "3 × 3 농구", "3X3 BASKETBALL"]) assert.equal(resolveSportIcon("auto", name).key, "basketball-3x3");
  for (const name of ["TABLE TENNIS", "table-tennis", " 탁구 "]) assert.equal(resolveSportIcon("auto", name).key, "table-tennis");
  assert.equal(resolveSportIcon("auto", "NET BALL").key, "netball");
  assert.equal(resolveSportIcon("auto", "새로운 종목").key, "generic");
  assert.equal(resolveSportIcon("https://example.invalid/evil.svg", "<script>alert(1)</script>").key, "generic");
  assert.equal(resolveSportIcon(undefined, "배구").key, "volleyball");
  assert.equal(resolveSportIcon("netball", "피구").key, "netball");
  assert.equal(resolveSportIcon("auto", "피구").key, "dodgeball");
  assert.equal(normalizeSportIconKey(undefined), "auto");
  assert.equal(normalizeSportIconKey(undefined, "netball"), "netball");
  assert.equal(normalizeSportIconKey("auto"), "auto");
  for (const value of [null, "", 1, true, {}, [], "volleyball ", "VOLLEYBALL", "../evil", "https://example.invalid/evil.svg"]) {
    assert.throws(() => normalizeSportIconKey(value));
  }
});

test("the icon picker renders 21 labeled native radios, a live preview, isolated groups, and disabled saving state", () => {
  const props = { name: "배구", iconKey: "auto", groupId: "new-sport", busy: false, onChange() {} };
  const automatic = render(SportIconPicker, props);
  assert.equal(inputs(automatic).length, 21);
  assert.deepEqual(checked(automatic), ["auto"]);
  assert.ok(inputs(automatic).every(input => /name="sport-icon-new-sport"/.test(input)));
  assert.match(automatic, /<fieldset[^>]*class="sport-icon-picker">/);
  assert.match(automatic, /<legend>종목 그림/);
  assert.match(automatic, /class="sport-icon-preview" aria-live="polite"/);
  assert.match(automatic, /현재 그림: 배구/);
  assert.match(automatic, /<details><summary>종목 그림 선택/);
  assert.match(automatic, /19개 종목 · 공통 그림/);
  for (const icon of SPORT_ICONS) assert.ok(automatic.includes("<b>" + icon.label + "</b>"));

  const manual = render(SportIconPicker, { ...props, name: "배구", iconKey: "netball", groupId: "existing-sport", busy: true });
  assert.deepEqual(checked(manual), ["netball"]);
  assert.match(manual, /<fieldset[^>]*disabled=""/);
  assert.ok(inputs(manual).every(input => /name="sport-icon-existing-sport"/.test(input)));
  const preview = manual.match(/class="sport-icon-preview"[\s\S]*?<\/div><\/div>/)?.[0] ?? "";
  assert.match(preview, /src="\/sport-icons\/netball.svg"/);
  assert.match(preview, /<b>넷볼<\/b>/);
  assert.doesNotMatch(preview, /volleyball.svg/);
  const escaped = render(SportIconPicker, { ...props, name: "<img src=x onerror=alert(1)>", groupId: 'bad"><script>' });
  assert.equal(checked(escaped)[0], "auto");
  assert.match(escaped, /&quot;&gt;&lt;script&gt;/);
  assert.doesNotMatch(escaped, /<script>|onerror=|src="(?:http|data:)/);
});

test("existing editors and result banners render saved icons while new editors default to automatic", () => {
  const props = { sport, levels: ["middle"], busy: false, async onSave() {} };
  const existing = render(SportEditor, props);
  assert.deepEqual(checked(existing), ["netball"]);
  assert.match(existing, /src="\/sport-icons\/netball.svg"/);
  const fresh = render(SportEditor, { ...props, sport: { ...sport, id: "new-sport", name: "", iconKey: undefined, divisions: [] }, isNew: true });
  assert.deepEqual(checked(fresh), ["auto"]);
  assert.match(fresh, /src="\/sport-icons\/generic.svg"/);
  const symbol = render(SportSymbol, { sport });
  assert.match(symbol, /aria-hidden="true"/);
  assert.match(symbol, /<img[^>]*src="\/sport-icons\/netball.svg"[^>]*alt=""/);
  const results = render(AdminPanel, { dashboard, async refresh() {} });
  const banner = results.match(/<header class="sport-metric-head">[\s\S]*?<\/header>/)?.[0] ?? "";
  assert.match(banner, /src="\/sport-icons\/netball.svg"/);
  assert.match(banner, /이름을 수정한 종목/);
  assert.doesNotMatch(banner, />VB<|>BB<|>DB</);
});

test("empty new-event management explains explicit sport setup and links to a usable first editor", async () => {
  // Render the real administrator component with its initial tab changed only in
  // this in-memory fixture; no production defaults or application files change.
  const sportsSource = client.replace(
    'useState<"results" | "event" | "sports" | "schools" | "account">("results")',
    'useState<"results" | "event" | "sports" | "schools" | "account">("sports")',
  );
  assert.notEqual(sportsSource, client);
  const { AdminPanel: SportsPanel } = await import(moduleUrl(sportsSource + "\nexport { AdminPanel };"));
  const empty = render(SportsPanel, { dashboard: { ...dashboard, sports: [] }, async refresh() {} });
  assert.match(empty, /class="sports-empty-state"/);
  assert.match(empty, /아직 등록된 종목이 없습니다/);
  assert.match(empty, /종목 없이 시작합니다/);
  assert.match(empty, /href="#new-sport-editor"[^>]*>\+ 첫 종목 추가하기/);
  assert.match(empty, /id="new-sport-editor"/);
  assert.match(empty, /<input[^>]*required=""[^>]*value=""/);
  assert.equal(inputs(empty).length, 21);
  assert.deepEqual(checked(empty), ["auto"]);
  assert.match(original, /종목과 종별은 빈 상태로 시작합니다/);
  assert.match(original, /setTab\("sports"\)/);
  const filled = render(SportsPanel, { dashboard, async refresh() {} });
  const summary = filled.match(/class="managed-sport-summary"[\s\S]*?class="managed-sport-actions"/)?.[0] ?? "";
  assert.match(summary, /src="\/sport-icons\/netball.svg"/);
  assert.match(summary, /이름을 수정한 종목/);
  assert.doesNotMatch(filled, /class="sports-empty-state"/);
});

test("sport management can shrink its grid, cards and fieldsets on narrow folded/mobile screens", async () => {
  const css = await readFile(new URL("app/redesign.css", root), "utf8");
  assert.match(css, /\.sports-management,\s*\.sports-management > \.settings-card,[^{]+\{\s*min-width:\s*0;/);
  assert.match(css, /\.sports-management \.sport-editor\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(css, /\.sports-management \.sport-divisions\s*\{\s*min-inline-size:\s*0;/);
  assert.match(css, /\.sport-icon-picker\s*\{\s*min-width:\s*0;/);
  assert.match(css, /\.admin-settings-grid\.sports-management\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
});
