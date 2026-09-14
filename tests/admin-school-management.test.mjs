import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("app/admin-school-management.tsx", root), "utf8");
const compiled = ts.transpileModule(source
  .replace('"react"', JSON.stringify(import.meta.resolve("react")))
  .replace('"./school-levels.js"', JSON.stringify(new URL("app/school-levels.js", root).href)), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replace('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
const { default: AdminSchoolManagement, SchoolRegistryList, InstitutionCodeEditor, normalizeInstitutionCodeConfirmation, changeSchoolInstitutionCode, requestSchoolRegistry, SchoolRegistryError } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("school registration exposes accessible fields and directs credential changes to the school list", () => {
  const html = renderToStaticMarkup(createElement(AdminSchoolManagement, {}));
  assert.match(html, /새 학교 등록/);
  assert.match(html, /value="elementary" selected=""/);
  assert.match(html, /value="middle"/);
  assert.match(html, /id="registry-school-name"/);
  assert.match(html, /id="registry-institution-code"[^>]*type="password"/);
  assert.match(html, /autoComplete="new-password"/);
  assert.match(html, /aria-label="기관번호 표시"/);
  assert.match(html, /동나 또는 동너/);
  assert.match(html, /숫자 2~4자리/);
  assert.match(html, /영문 키보드 입력/);
  assert.match(html, /이미 종료된 대회의 대상 학교 수와 기존 신청은 그대로 보존/);
  assert.match(html, /‘기관번호 수정’ 버튼에서 변경/);
  assert.match(html, /aria-label="등록 학교급 필터"/);
  assert.match(source, /if \(requestInFlight.current\) return/);
  assert.match(source, /setInstitutionCode\(""\)/);
  assert.match(source, /if \(onAdded\)/);
  assert.doesNotMatch(html, /<table/);
});

test("school registry list groups levels and never renders institution codes or hashes", () => {
  const schools = [
    { id: "middle", name: "예시중학교", schoolLevel: "middle", displayOrder: 1, active: true, institutionCode: "SECRET-CODE", passwordHash: "SECRET-HASH" },
    { id: "elementary-2", name: "둘째예시초등학교", schoolLevel: "elementary", displayOrder: 2, active: false },
    { id: "elementary-1", name: "첫째예시초등학교", schoolLevel: "elementary", displayOrder: 1, active: true },
  ];
  const html = renderToStaticMarkup(createElement(SchoolRegistryList, { schools, onEditInstitutionCode() {}, editingSchoolId: "middle" }));
  assert.ok(html.indexOf("첫째예시초등학교") < html.indexOf("둘째예시초등학교"));
  assert.ok(html.indexOf("둘째예시초등학교") < html.indexOf("예시중학교"));
  assert.match(html, /초등학교 순번 1/);
  assert.match(html, /중학교 순번 1/);
  assert.match(html, /비활성/);
  assert.match(html, /aria-label="예시중학교 기관번호 수정"[^>]*aria-expanded="true"/);
  assert.equal((html.match(/class="school-registry-edit-button"/g) ?? []).length, 3);
  assert.equal((html.match(/aria-controls="school-institution-code-editor"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /SECRET-CODE|SECRET-HASH|<table/);
});

test("registry requests use the authenticated API and include credentials only in POST body", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(options.method === "GET" ? { schools: [] } : { school: { id: "example", name: "예시초등학교", schoolLevel: "elementary", displayOrder: 74 } }), { headers: { "Content-Type": "application/json" } });
  });
  assert.deepEqual(await requestSchoolRegistry(), { schools: [] });
  const registration = { name: "예시초등학교", schoolLevel: "elementary", institutionCode: "example-code" };
  await requestSchoolRegistry(registration);
  assert.equal(calls[0].url, "/api/admin/schools");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[1].options.credentials, "same-origin");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[1].options.body), registration);
  assert.doesNotMatch(calls[1].url, /example-code/);
});

test("registry handles expired login and preserves actionable validation errors", async (t) => {
  const responses = [
    new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    new Response(JSON.stringify({ error: "이미 등록된 학교입니다." }), { status: 409 }),
    new Response("Unexpected server output", { status: 500 }),
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift());
  await assert.rejects(requestSchoolRegistry(), error => error instanceof SchoolRegistryError && error.status === 401 && /다시 로그인/.test(error.message));
  await assert.rejects(requestSchoolRegistry(), /이미 등록된 학교/);
  await assert.rejects(requestSchoolRegistry(), /서버 응답을 확인하지 못했습니다/);
});

test("uncertain registration requests ask administrators to check the list before retrying", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(requestSchoolRegistry({ name: "예시초등학교", schoolLevel: "elementary", institutionCode: "example-code" }), /등록 여부를 확인/);
  await assert.rejects(requestSchoolRegistry(), /인터넷 연결을 확인/);
});

test("registry responsive styles avoid table overflow and preserve vertical scroll chaining", async () => {
  const css = await readFile(new URL("app/survey-management.css", root), "utf8");
  assert.match(css, /\.school-registry-scroll \{[^}]*overflow-y: auto;[^}]*overscroll-behavior-y: auto/);
  assert.match(css, /\.school-registry-list li \{[^}]*minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /\.school-registration-card \.solid-button \{[^}]*justify-content: center;[^}]*align-items: center/);
});

test("institution-code editor is blank by default and explicitly confirms session revocation", () => {
  const school = { id: "example-school", name: "수정예시초등학교", schoolLevel: "elementary", displayOrder: 1, institutionCode: "SECRET-CODE", passwordHash: "SECRET-HASH" };
  const props = { school, onBusyChange() {}, async onSaved() {}, onCancel() {}, onAuthenticationExpired() {} };
  const html = renderToStaticMarkup(createElement(InstitutionCodeEditor, props));
  assert.match(html, /id="school-institution-code-editor"/);
  assert.match(html, /수정예시초등학교/);
  assert.match(html, /초등학교/);
  assert.equal((html.match(/type="password"/g) ?? []).length, 2);
  assert.equal((html.match(/value=""/g) ?? []).length, 2);
  assert.match(html, /새 기관번호 확인/);
  assert.match(html, /aria-label="새 기관번호 표시"/);
  assert.match(html, /이전 기관번호는 사용할 수 없고/);
  assert.match(html, /기존 로그인은 종료/);
  assert.match(html, /저장된 신청과 학교 정보는 그대로 유지/);
  assert.match(html, /현재 기관번호는 조회하거나 미리 채우지 않습니다/);
  assert.match(html, /기관번호 변경 저장/);
  assert.doesNotMatch(html, /SECRET-CODE|SECRET-HASH|role="dialog"/);
  const disabled = renderToStaticMarkup(createElement(InstitutionCodeEditor, { ...props, disabled: true }));
  assert.match(disabled, /id="registry-new-institution-code"[^>]*disabled=""/);
  assert.match(disabled, /type="submit"[^>]*disabled=""/);
  const middle = renderToStaticMarkup(createElement(InstitutionCodeEditor, { ...props, school: { ...school, schoolLevel: "middle" } }));
  assert.match(middle, /동다 또는 동더/);
  assert.match(source, /key=\{editingSchool.id\}/);
  assert.match(source, /function clearDrafts\(\) \{ setNextCode\(""\); setConfirmation\(""\); setShowCode\(false\);/);
  assert.match(source, /if \(blocked \|\| requestInFlight.current\) return/);
  assert.match(source, /setCodeNotice\(result.changed === false/);
});

test("institution-code confirmation treats Korean and English keyboard input equally", () => {
  const number = "9".repeat(4);
  for (const [english, korean] of [["ehdsk", "동나"], ["ehdsj", "동너"], ["ehdek", "동다"], ["ehdej", "동더"]]) {
    assert.equal(normalizeInstitutionCodeConfirmation(" " + english.toUpperCase() + number + " "), korean + number);
    assert.equal(normalizeInstitutionCodeConfirmation((korean + number).normalize("NFD")), korean + number);
  }
  assert.equal(normalizeInstitutionCodeConfirmation(" invalid-entry "), "invalid-entry");
});

test("institution-code changes use the scoped PATCH endpoint and never put codes in URLs", async (t) => {
  const calls = [];
  const result = { ok: true, school: { id: "school/id", name: "예시중학교", schoolLevel: "middle", displayOrder: 1 }, sessionsRevoked: 3, changed: true };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(result), { status: 200 });
  });
  assert.deepEqual(await changeSchoolInstitutionCode("school/id", "private-new-code"), result);
  assert.equal(calls[0].url, "/api/admin/schools/school%2Fid/institution-code");
  assert.equal(calls[0].options.method, "PATCH");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(calls[0].options.body), { institutionCode: "private-new-code" });
  assert.doesNotMatch(calls[0].url, /private-new-code/);
});

test("institution-code errors preserve validation guidance and make uncertain changes explicit", async (t) => {
  const responses = [
    new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    new Response(JSON.stringify({ error: "이미 다른 학교에 등록된 기관번호입니다." }), { status: 409 }),
    new Response(JSON.stringify({ error: "이 학교급에 맞는 기관번호를 입력해 주세요." }), { status: 400 }),
    new Response("Unreadable response", { status: 200 }),
    new Response(JSON.stringify({ ok: true, school: { id: "different" }, sessionsRevoked: 0 }), { status: 200 }),
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift());
  await assert.rejects(changeSchoolInstitutionCode("school", "new-code"), error => error instanceof SchoolRegistryError && error.status === 401 && /다시 로그인/.test(error.message));
  await assert.rejects(changeSchoolInstitutionCode("school", "new-code"), /다른 학교에 등록/);
  await assert.rejects(changeSchoolInstitutionCode("school", "new-code"), /학교급에 맞는/);
  await assert.rejects(changeSchoolInstitutionCode("school", "new-code"), /자동으로 재시도하지 않았습니다/);
  await assert.rejects(changeSchoolInstitutionCode("school", "new-code"), /같은 번호를 다시 저장/);
});

test("institution-code request failures do not retry or disclose the submitted code", async (t) => {
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => { attempts++; throw new TypeError("Disconnected"); });
  await assert.rejects(changeSchoolInstitutionCode("school", "private-new-code"), error => /변경 결과를 확인하지 못했습니다/.test(error.message) && !error.message.includes("private-new-code"));
  assert.equal(attempts, 1);
});
