// Isolated, manual browser regression harness. This never contacts Cloudflare,
// production databases, or account credentials. Restart after product edits.
// Run: node tests/logo-browser-server.mjs [port]
// Open: http://127.0.0.1:4319/?project=application (or project=form)
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { DatabaseSync } from "node:sqlite";

const port = Number(process.argv[2] || 4319);
assert(Number.isInteger(port) && port > 1024 && port < 65536, "Invalid local port");
const projectRoots = {
  application: new URL("../", import.meta.url),
  form: new URL("../../dongbu-form/", import.meta.url),
};

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
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

class TestR2 {
  objects = new Map();
  async put(key, bytes) { this.objects.set(key, new Uint8Array(bytes)); }
  async get(key) {
    const bytes = this.objects.get(key);
    return bytes ? { body: new Blob([bytes]).stream(), size: bytes.byteLength } : null;
  }
  async delete(key) { this.objects.delete(key); }
}

async function makeFixture(root) {
  const apiUrl = new URL("worker/api.ts", root);
  const source = (await readFile(apiUrl, "utf8")).replace(/from\s+(["'])(\.[^"']+)\1/g,
    (_whole, _quote, specifier) => `from ${JSON.stringify(new URL(specifier, apiUrl).href)}`);
  const { handleApi } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
  const clientSource = await readFile(new URL("app/survey-app-client.tsx", root), "utf8");
  const start = clientSource.indexOf("async function prepareLogoImage(");
  const end = clientSource.indexOf("\nfunction LogoImageEditor(", start);
  assert(start >= 0 && end > start, "Cannot locate actual prepareLogoImage function");
  const cleanPngFunction = (await readFile(new URL("app/logo-png.js", root), "utf8")).replace("export function", "function");
  const prepareFunction = cleanPngFunction + "\n" + stripTypeScriptTypes(clientSource.slice(start, end));
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const migrations = new URL("drizzle/", root);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(await readFile(new URL(file, migrations), "utf8"));
  }
  const env = {
    DB: new TestD1(sqlite), LOGO_FILES: new TestR2(),
    ADMIN_USERNAME: "isolated-logo-check", ADMIN_PASSWORD: randomBytes(32).toString("hex"),
    SCHOOL_PASSWORD_PEPPER: randomBytes(32).toString("hex"),
  };
  async function call(path, { method = "GET", body, type = "application/json", cookie } = {}) {
    return handleApi(new Request(`https://test.example/api/${path}`, {
      method,
      headers: { "Content-Type": type, Origin: "https://test.example", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body }),
    }), env);
  }
  const login = await call("admin/login", {
    method: "POST", body: JSON.stringify({ username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }),
  });
  assert.equal(login.status, 200, "Isolated admin login must succeed");
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert(cookie, "Isolated session cookie missing");
  const bootstrap = await (await call("bootstrap")).json();
  return { sqlite, env, call, cookie, id: bootstrap.tournament.id, prepareFunction };
}

const fixtures = Object.fromEntries(await Promise.all(Object.entries(projectRoots).map(async ([key, root]) => [key, await makeFixture(root)])));

function pngInfo(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { bytes: bytes.length, format: "not-png" };
  }
  const chunks = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (offset + length + 12 > bytes.length) { chunks.push({ type, length, truncated: true }); break; }
    chunks.push({ type, length });
    offset += length + 12;
  }
  return { bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bitDepth: bytes[24], colorType: bytes[25], chunks };
}

async function requestBytes(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) throw new Error("Local diagnostic upload exceeds 12MB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function page(project, prepareFunction) {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>격리된 로고 업로드 검증 · ${project}</title>
<style>body{max-width:1000px;margin:40px auto;padding:20px;font:17px system-ui;color:#123f43;background:#f1f8f8}section{background:white;padding:24px;border:1px solid #bed9da;border-radius:16px;margin:20px 0}button,input{font:inherit;margin:10px 0;padding:12px}button{color:white;background:#0a4a50;border:0;border-radius:8px}button:disabled{opacity:.5}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px ui-monospace,monospace}img{max-width:280px;max-height:280px;object-fit:contain;border:1px solid #acc}#error{color:#b00020}</style>
<h1>${project === "form" ? "수요조사" : "참가신청"} 로고 업로드 검증</h1>
<p>실제 이미지 처리 함수와 실제 API · 메모리 SQLite/R2만 사용 · 운영 데이터 변경 없음</p>
<nav><a href="/?project=application">참가신청 검증</a> · <a href="/?project=form">수요조사 검증</a></nav>
<section><label for="logo-file">이미지 파일 선택</label><br><input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp"><div><button id="synthetic-srgb" type="button">8×8 기본 색상 검증</button> <button id="synthetic-p3" type="button">8×8 Display-P3 검증</button></div><p id="state" role="status">파일을 선택해 주세요.</p><p id="error" role="alert"></p><button id="save" type="button" disabled>로고 이미지 저장</button><br><img id="preview" alt="변환된 로고 미리보기" hidden></section>
<section><h2>이미지 진단</h2><pre id="diagnostics">아직 이미지 없음</pre></section>
<section><h2>실제 API 결과</h2><pre id="result">아직 저장하지 않음</pre><a id="fixture-download" hidden>합성 PNG 회귀 테스트 파일 다운로드</a><br><img id="saved" alt="API에 저장된 로고" hidden></section>
<script>
${prepareFunction}
const project = ${JSON.stringify(project)};
const input = document.getElementById('logo-file');
const state = document.getElementById('state');
const error = document.getElementById('error');
const save = document.getElementById('save');
let prepared = null;
let original = null;
async function inspectPng(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const chunks = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    chunks.push({ type, length });
    if (offset + length + 12 > bytes.length) break;
    offset += length + 12;
  }
  return {bytes:bytes.length,width:view.getUint32(16),height:view.getUint32(20),bitDepth:bytes[24],colorType:bytes[25],chunks};
}
async function chooseFile(file, synthetic = false, sourceColorSpace = null) {
  if (!file) return;
  input.disabled = true; save.disabled = true; error.textContent = ''; prepared = null;
  state.textContent = '실제 프론트엔드 함수로 이미지 변환 중…';
  document.getElementById('saved').hidden = true;
  document.getElementById('fixture-download').hidden = true;
  document.getElementById('result').textContent = '아직 저장하지 않음';
  try {
    const sourceUrl = URL.createObjectURL(file);
    try {
      const picture = new Image();
      picture.src = sourceUrl;
      await picture.decode();
      original = {name:file.name,type:file.type,bytes:file.size,width:picture.naturalWidth,height:picture.naturalHeight,synthetic,sourceColorSpace};
    } finally { URL.revokeObjectURL(sourceUrl); }
    prepared = await prepareLogoImage(file);
    document.getElementById('diagnostics').textContent = JSON.stringify({original,prepared:await inspectPng(prepared.blob)},null,2);
    document.getElementById('preview').src = prepared.preview;
    document.getElementById('preview').hidden = false;
    state.textContent = '변환 완료 · 저장 전 · ' + file.name;
    save.disabled = false;
  } catch(reason) { error.textContent = reason.message; state.textContent = '변환 실패'; }
  finally { input.disabled = false; }
}
input.addEventListener('change', () => chooseFile(input.files[0]));
async function synthetic(colorSpace) {
  const canvas = document.createElement('canvas');
  canvas.width = 8; canvas.height = 8;
  const context = canvas.getContext('2d', {colorSpace});
  context.fillStyle = '#ef725a'; context.fillRect(0,0,8,8);
  context.fillStyle = '#2ec4b6'; context.fillRect(0,0,4,4);
  context.fillStyle = 'rgba(90,60,220,0.5)'; context.clearRect(0,4,8,4); context.fillRect(0,4,8,4);
  const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
  await chooseFile(new File([blob], 'synthetic-8x8-' + colorSpace + '.png', {type:'image/png'}), true, context.getContextAttributes?.().colorSpace || colorSpace);
}
document.getElementById('synthetic-srgb').addEventListener('click', () => synthetic('srgb'));
document.getElementById('synthetic-p3').addEventListener('click', () => synthetic('display-p3'));
save.addEventListener('click', async () => {
  if (!prepared) return;
  save.disabled = true; input.disabled = true; error.textContent = ''; state.textContent = '실제 API로 저장 중…';
  try {
    const body = new FormData();
    body.append('image', prepared.blob, 'normalized.png');
    body.append('original',JSON.stringify(original));
    const response = await fetch('/test-upload?project=' + project,{method:'POST',body});
    const result = await response.json();
    document.getElementById('result').textContent = JSON.stringify(result,null,2);
    if (result.syntheticDownloadUrl) {
      const link = document.getElementById('fixture-download');
      link.href = result.syntheticDownloadUrl; link.hidden = false;
    }
    if (!response.ok || result.apiStatus !== 200) throw new Error(result.apiBody?.error || result.error || '로고 API 저장 실패');
    const image = document.getElementById('saved');
    image.src = result.savedUrl;
    await image.decode();
    image.hidden = false;
    state.textContent = '저장 성공 · HTTP 200 · 저장된 로고 이미지 표시 확인';
  } catch(reason) { error.textContent = reason.message; state.textContent = '저장 실패'; }
  finally { save.disabled = false; input.disabled = false; }
});
</script></html>`;
}

const server = createServer(async (request, response) => {
  const sendJson = (status, data) => { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); response.end(JSON.stringify(data)); };
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    const project = url.searchParams.get("project") || "application";
    const fixture = fixtures[project];
    if (!fixture) return sendJson(400, { error: "Unknown test project" });
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return response.end(page(project, fixture.prepareFunction));
    }
    if (request.method === "POST" && url.pathname === "/test-upload") {
      if (request.headers.origin !== `http://127.0.0.1:${port}`) return sendJson(403, { error: "Local origin required" });
      const localRequest = new Request(url, { method: "POST", headers: { "Content-Type": request.headers["content-type"] || "" }, body: await requestBytes(request) });
      const form = await localRequest.formData();
      const file = form.get("image");
      if (!(file instanceof Blob)) return sendJson(400, { error: "Image missing" });
      const bytes = Buffer.from(await file.arrayBuffer());
      const original = JSON.parse(form.get("original") || "null");
      // The browser-generated sample is the only input eligible for export.
      // Uploaded user image bytes are never exposed by this diagnostic route.
      const isSynthetic = original?.synthetic === true && original?.width === 8 && original?.height === 8 && original?.name?.startsWith("synthetic-8x8-");
      if (isSynthetic) fixture.lastSynthetic = Buffer.from(bytes);
      const result = await fixture.call(`admin/events/${fixture.id}/logo`, { method: "PUT", body: bytes, type: "image/png", cookie: fixture.cookie });
      const apiBody = await result.json();
      return sendJson(result.status, {
        project, original, receivedPng: pngInfo(bytes),
        apiStatus: result.status, apiBody, storageObjectCount: fixture.env.LOGO_FILES.objects.size,
        ...(isSynthetic ? { syntheticDownloadUrl: `/synthetic-fixture?project=${project}` } : {}),
        ...(result.status === 200 ? { savedUrl: `/saved?project=${project}&key=${encodeURIComponent(apiBody.logoKey)}` } : {}),
      });
    }
    if (request.method === "GET" && url.pathname === "/synthetic-fixture") {
      if (!fixture.lastSynthetic) return sendJson(404, { error: "No browser-generated synthetic image uploaded yet" });
      response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="synthetic-browser-${project}-8x8.png"` });
      return response.end(fixture.lastSynthetic);
    }
    if (request.method === "GET" && url.pathname === "/saved") {
      const key = url.searchParams.get("key") || "";
      if (!/^[a-f0-9-]{36}$/.test(key)) return sendJson(400, { error: "Invalid local image key" });
      const result = await fixture.call(`events/${fixture.id}/logo/${key}`, { cookie: fixture.cookie });
      response.writeHead(result.status, { "Content-Type": result.headers.get("content-type") || "application/octet-stream", "Cache-Control": "no-store" });
      return response.end(Buffer.from(await result.arrayBuffer()));
    }
    return sendJson(404, { error: "Not found" });
  } catch (error) { return sendJson(500, { error: String(error?.message || error) }); }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Isolated logo browser test: http://127.0.0.1:${port}/?project=application`);
  console.log(`Survey mode: http://127.0.0.1:${port}/?project=form`);
  console.log("In-memory test databases only; production data and credentials are never read.");
});
const stop = () => server.close(() => { for (const fixture of Object.values(fixtures)) fixture.sqlite.close(); process.exit(0); });
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
