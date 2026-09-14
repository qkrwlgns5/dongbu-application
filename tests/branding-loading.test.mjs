import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const root = new URL("../", import.meta.url);
const hookShim = `data:text/javascript;base64,${Buffer.from([
  'export { Fragment } from ' + JSON.stringify(import.meta.resolve("react")) + ';',
  ...["useState", "useRef", "useEffect", "useMemo"].map((name) =>
    'export const ' + name + ' = (...args) => globalThis.__brandingHooks.' + name + '(...args);'),
].join("\n")).toString("base64")}`;
let source = (await readFile(new URL("app/survey-app-client.tsx", root), "utf8"))
  .replace('"react"', JSON.stringify(hookShim))
  .replace('import AdminSchoolManagement from "./admin-school-management";', 'const AdminSchoolManagement = () => null;');
for (const name of ["event-card-copy", "page-header-copy", "school-levels", "sport-icons", "logo-png"]) {
  source = source.replace(JSON.stringify(`./${name}.js`), JSON.stringify(new URL(`app/${name}.js`, root).href));
}
const compiled = ts.transpileModule(source + "\nexport { Brand };", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replace('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
const { SurveyApp, Brand } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

function harness(Component, initialProps) {
  let cursor = 0;
  let props = initialProps;
  const slots = [];
  let effects = [];
  const same = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(callback, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || !same(previous.dependencies, dependencies)) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { dependencies, cleanup: callback() }; });
      }
    },
    useMemo(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].dependencies, dependencies)) slots[index] = { dependencies, value: callback() };
      return slots[index].value;
    },
  };
  return {
    render(nextProps = props) {
      props = nextProps;
      cursor = 0;
      effects = [];
      globalThis.__brandingHooks = hooks;
      const tree = Component(props);
      for (const run of effects) run();
      return tree;
    },
    unmount() { for (const value of slots) value?.cleanup?.(); },
  };
}

const event = (id, logoKey = `logo-${id}`) => ({
  id, name: `대회 ${id}`, academicYear: 2027, logoKey,
  headerCopy: JSON.stringify({ brandName: `기관 ${id}`, logoText: "D", titlePrimary: `제목 ${id}`, titleSecondary: "" }),
  cardCopy: "{}", schoolLevels: '["middle"]', status: "active",
  surveyStart: "2027-01-01T00:00:00.000Z", surveyEnd: "2027-12-31T00:00:00.000Z",
});
const boot = (tournament) => ({ tournament, tournaments: [tournament], schools: [], sports: [], surveyState: { open: true } });
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function withNetwork(work) {
  const original = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document, hooks: globalThis.__brandingHooks };
  const requests = [];
  globalThis.window = { location: { search: "" }, history: { replaceState() {} } };
  globalThis.document = { title: "중립 제목" };
  globalThis.fetch = (path, init) => new Promise((resolve, reject) => requests.push({
    path, init, reject,
    respond(payload, status = 200) { resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } })); },
  }));
  try { await work(requests); } finally {
    globalThis.fetch = original.fetch;
    if (original.window === undefined) delete globalThis.window; else globalThis.window = original.window;
    if (original.document === undefined) delete globalThis.document; else globalThis.document = original.document;
    if (original.hooks === undefined) delete globalThis.__brandingHooks; else globalThis.__brandingHooks = original.hooks;
  }
}

function assertNeutral(tree) {
  assert.equal(tree.type.name, "PageLoader");
  assert.doesNotMatch(renderToStaticMarkup(tree), /brand-image|brand-mark|기관 |제목 |동부교육지원청/);
  assert.doesNotMatch(document.title, /기관 |제목 |동부교육지원청/);
}

test("slow bootstrap and school-session resolution never expose the default event before the signed-in event", () => withNetwork(async (requests) => {
  const app = harness(SurveyApp, {});
  assertNeutral(app.render());
  assert.equal(requests[0].path, "/api/bootstrap");
  assert.equal(requests[0].init.cache, "no-store");
  requests[0].respond(boot(event("default")));
  await tick();
  assertNeutral(app.render());
  assert.equal(requests[1].path, "/api/school/session");
  requests[1].respond({ tournament: event("session"), school: { id: "school", name: "학교" }, sports: [], survey: { selections: [] } });
  await tick();
  const ready = app.render();
  assert.equal(ready.type.name, "SurveyForm");
  assert.equal(ready.props.session.tournament.id, "session");
  assert.equal(document.title, "제목 session");
  app.unmount();
}));

test("administrator waits for the selected dashboard event without flashing public bootstrap branding", () => withNetwork(async (requests) => {
  const app = harness(SurveyApp, { initialView: "admin" });
  assertNeutral(app.render());
  requests[0].respond(boot(event("public")));
  await tick();
  assertNeutral(app.render());
  assert.equal(requests[1].path, "/api/admin/dashboard");
  requests[1].respond({ selectedEvent: event("admin-selected"), events: [], sports: [], rows: [], adminUsername: "admin" });
  await tick();
  const ready = app.render();
  assert.equal(ready.type.name, "AdminPanel");
  assert.equal(document.title, "관리자 · 제목 admin-selected");
  app.unmount();
}));

test("signed-out visitors only receive saved public branding after the session check completes", () => withNetwork(async (requests) => {
  for (const initialView of ["school", "admin"]) {
    requests.length = 0;
    const app = harness(SurveyApp, { initialView });
    assertNeutral(app.render());
    requests[0].respond(boot(event("saved")));
    await tick();
    assertNeutral(app.render());
    requests[1].respond({ error: "로그인이 필요합니다." }, 401);
    await tick();
    const ready = app.render();
    assert.equal(ready.type.name, initialView === "admin" ? "AdminLogin" : "SchoolLogin");
    assert.equal(document.title, initialView === "admin" ? "관리자 · 제목 saved" : "제목 saved");
    app.unmount();
  }
}));

test("failed bootstrap does not reveal fallback branding", () => withNetwork(async (requests) => {
  const app = harness(SurveyApp, {});
  assertNeutral(app.render());
  requests[0].reject(new TypeError("Network unavailable"));
  await tick();
  const failed = app.render();
  assert.equal(failed.type.name, "ErrorState");
  assert.doesNotMatch(renderToStaticMarkup(failed), /brand-image|brand-mark|동부교육지원청/);
  assert.doesNotMatch(document.title, /기관 |제목 |동부교육지원청/);
  app.unmount();
}));

test("a changed logo is keyed and invisible until it loads; failures never restore the legacy lettermark", () => withNetwork(async () => {
  const brand = harness(Brand, { tournament: event("same", "first") });
  let tree = brand.render();
  let image = tree.props.children[0];
  assert.equal(image.type, "img");
  assert.equal(image.props.style.visibility, "hidden");
  image.props.onLoad();
  tree = brand.render();
  image = tree.props.children[0];
  assert.equal(image.props.style.visibility, "visible");
  const previousKey = image.key;
  tree = brand.render({ tournament: event("same", "replacement") });
  image = tree.props.children[0];
  assert.notEqual(image.key, previousKey);
  assert.equal(image.props.style.visibility, "hidden");
  assert.doesNotMatch(renderToStaticMarkup(tree), /brand-mark|logo\/first/);
  image.props.onError();
  tree = brand.render();
  assert.equal(tree.props.children[0].type, "img");
  assert.equal(tree.props.children[0].props.style.visibility, "hidden");
  assert.doesNotMatch(renderToStaticMarkup(tree), /brand-mark/);
  tree.props.children[0].props.onLoad();
  assert.equal(brand.render().props.children[0].props.style.visibility, "visible");
  tree = brand.render({ tournament: event("same", "") });
  assert.equal(tree.props.children[0].props.className, "brand-mark", "lettermarks remain available when no image is configured");
  brand.unmount();
}));

