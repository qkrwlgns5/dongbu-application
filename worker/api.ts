import { normalizeSchoolPasswordInput } from "./school-password.js";
import { validateTeamLimitConfiguration, validateTeamSelection } from "./team-limits.js";
import { normalizeEventCardCopy } from "../app/event-card-copy.js";
import { normalizePageHeaderCopy } from "../app/page-header-copy.js";
import { MAX_LOGO_BYTES, validateLogoPng, logoObjectKey } from "./logo-image.js";
import { SCHOOL_LEVELS, schoolLevels, validateSchoolLevels } from "../app/school-levels.js";

type SchoolLevel = "elementary" | "middle";

export interface Env {
  DB: D1Database;
  LOGO_FILES?: R2Bucket;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  SCHOOL_PASSWORD_PEPPER?: string;
}

interface ApiError extends Error {
  status?: number;
  code?: string;
}

interface TournamentRow {
  id: string;
  academicYear: number;
  schoolLevels: string;
  name: string;
  surveyStart: string;
  cardCopy: string;
  headerCopy: string;
  logoKey: string;
  surveyEnd: string;
  status: "draft" | "active" | "archived";
}

interface SessionRow {
  actorType: "school" | "admin";
  schoolId: string | null;
  tournamentId: string | null;
  adminAuthVersion: number | null;
}

interface AdminCredentialRow {
  username: string;
  passwordAlgorithm: string;
  passwordSalt: string;
  passwordHash: string;
  passwordIterations: number;
  authVersion: number;
}

interface SchoolCredentialSnapshot {
  passwordSalt: string;
  passwordHash: string;
  passwordIterations: number;
}

interface SportRow {
  id: string;
  name: string;
  displayOrder: number;
  teamCountEnabled: number;
  maxTeamsPerSchool: number;
  maxTeamsPerDivision: number;
  active: number;
}

interface DivisionRow {
  id: string;
  sportId: string;
  name: string;
  schoolLevel: SchoolLevel;
  displayOrder: number;
  active: number;
}

interface SportDetailRow extends SportRow {
  tournamentId: string;
}

const SCHOOL_COOKIE = "dongbu_school_session";
const ADMIN_COOKIE = "dongbu_admin_session";
const SCHOOL_SESSION_SECONDS = 60 * 60;
const ADMIN_SESSION_SECONDS = 60 * 60 * 8;
const MAX_JSON_BYTES = 32_000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_FAILURES = 5;
const ADMIN_PASSWORD_ALGORITHM = "pbkdf2-sha256-admin-v1";
// Cloudflare Workers WebCrypto currently rejects PBKDF2 iteration counts above 100,000.
const ADMIN_PASSWORD_ITERATIONS = 100_000;
const ADMIN_PASSWORD_MIN_LENGTH = 8;
const ADMIN_PASSWORD_MAX_LENGTH = 128;

function apiError(message: string, status = 400, code = "BAD_REQUEST"): ApiError {
  const error = new Error(message) as ApiError;
  error.status = status;
  error.code = code;
  return error;
}

function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  headers.set("Pragma", "no-cache");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(JSON.stringify(data), { status, headers });
}

async function readJson<T>(request: Request): Promise<T> {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    throw apiError("JSON 형식으로 요청해 주세요.", 415, "UNSUPPORTED_MEDIA_TYPE");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw apiError("입력 내용이 너무 큽니다.", 413, "PAYLOAD_TOO_LARGE");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw apiError("요청 내용을 읽을 수 없습니다.");
  }
}

function assertSameOrigin(request: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw apiError("허용되지 않은 요청입니다.", 403, "ORIGIN_MISMATCH");
  }
}

function getCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function sessionCookie(request: Request, name: string, value: string, seconds: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=${seconds}`;
}

function clearCookie(request: Request, name: string): string {
  return sessionCookie(request, name, "", 0);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(bytes = 32): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return toBase64Url(data);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(digest));
}

async function hashSchoolPassword(password: string, pepper: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.trim().normalize("NFC") + pepper),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromBase64Url(salt), iterations },
    key,
    256,
  );
  return toBase64Url(new Uint8Array(bits));
}

async function hashAdminPassword(password: string, pepper: string, salt: string, iterations: number): Promise<string> {
  const normalized = password.normalize("NFC");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`dongbu-admin-v1\0${normalized}\0${pepper}`),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromBase64Url(salt), iterations },
    key,
    256,
  );
  return toBase64Url(new Uint8Array(bits));
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length, 1);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index % Math.max(a.length, 1)] ?? 0) ^ (b[index % Math.max(b.length, 1)] ?? 0);
  }
  return difference === 0;
}

function cleanText(value: unknown, field: string, max = 100): string {
  const text = String(value ?? "").trim().normalize("NFC");
  if (!text) throw apiError(`${field}을(를) 입력해 주세요.`);
  if (text.length > max) throw apiError(`${field}은(는) ${max}자 이내로 입력해 주세요.`);
  return text;
}

function parseIsoDate(value: unknown, field: string): string {
  const text = cleanText(value, field, 50);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw apiError(`${field}을(를) 확인해 주세요.`);
  return date.toISOString();
}

function tournamentState(tournament: TournamentRow | null) {
  if (!tournament || tournament.status !== "active") {
    return { open: false, code: "UNAVAILABLE", message: "진행 중인 참가 신청가 없습니다." };
  }
  const now = Date.now();
  const start = new Date(tournament.surveyStart).getTime();
  const end = new Date(tournament.surveyEnd).getTime();
  if (now < start) return { open: false, code: "NOT_STARTED", message: "참가 신청가 아직 시작되지 않았습니다." };
  if (now >= end) return { open: false, code: "ENDED", message: "참가 신청 기간이 종료되었습니다." };
  return { open: true, code: "OPEN", message: "참가 신청 진행 중입니다." };
}

async function activeTournament(db: D1Database): Promise<TournamentRow | null> {
  return db.prepare(
    `SELECT t.id, t.academic_year AS academicYear, t.name,
       t.survey_start AS surveyStart, t.survey_end AS surveyEnd, t.status, t.card_copy AS cardCopy, t.header_copy AS headerCopy, t.logo_key AS logoKey, t.school_levels AS schoolLevels
     FROM app_config c JOIN tournaments t ON t.id = c.active_tournament_id
     WHERE c.id = 1 AND t.status = 'active'`,
  ).first<TournamentRow>();
}

async function tournamentById(db: D1Database, id: string): Promise<TournamentRow | null> {
  return db.prepare(
    `SELECT id, academic_year AS academicYear, name,
       survey_start AS surveyStart, survey_end AS surveyEnd, status, card_copy AS cardCopy, header_copy AS headerCopy, logo_key AS logoKey, school_levels AS schoolLevels
     FROM tournaments WHERE id = ?`,
  ).bind(id).first<TournamentRow>();
}

async function publicTournaments(db: D1Database) {
  const result = await db.prepare(
    `SELECT id, academic_year AS academicYear, name, survey_start AS surveyStart,
       survey_end AS surveyEnd, status, card_copy AS cardCopy, header_copy AS headerCopy,
       logo_key AS logoKey, school_levels AS schoolLevels
     FROM tournaments WHERE status = 'active' ORDER BY academic_year DESC, created_at DESC, id`,
  ).all<TournamentRow>();
  return result.results.map((tournament) => ({ ...tournament, surveyState: tournamentState(tournament) }));
}

async function publishedTournamentSelection(db: D1Database, requestedId?: unknown) {
  const [tournaments, preferred] = await Promise.all([publicTournaments(db), activeTournament(db)]);
  const preferredPublic = tournaments.find((tournament) => tournament.id === preferred?.id);
  const defaultTournament = (preferredPublic?.surveyState.open ? preferredPublic : tournaments.find((tournament) => tournament.surveyState.open))
    ?? preferredPublic ?? tournaments[0] ?? null;
  let selected: (typeof tournaments)[number] | null = defaultTournament;
  if (requestedId !== undefined && requestedId !== null) {
    const id = cleanText(requestedId, "대회", 80);
    selected = tournaments.find((tournament) => tournament.id === id) ?? null;
    if (!selected) throw apiError("공개된 참가 신청를 찾을 수 없습니다.", 404, "NOT_FOUND");
  }
  // Keep the selected-event contract stable: surveyState is supplied beside it.
  const tournament = selected ? (({ surveyState: _state, ...row }) => row)(selected) : null;
  return { tournament, tournaments, defaultEventId: defaultTournament?.id ?? null };
}

function assertExpectedTournament(request: Request, tournamentId: string, bodyId?: unknown) {
  for (const expected of [new URL(request.url).searchParams.get("tournamentId"), bodyId]) {
    if (expected !== undefined && expected !== null && expected !== tournamentId) {
      throw apiError("다른 창에서 로그인한 대회가 변경되었습니다. 선택한 대회에 다시 로그인해 주세요.", 409, "EVENT_CHANGED");
    }
  }
}

function assertExpectedSchool(request: Request, schoolId: string, bodyId?: unknown) {
  for (const expected of [new URL(request.url).searchParams.get("schoolId"), bodyId]) {
    if (expected !== undefined && expected !== null && expected !== schoolId) {
      throw apiError("다른 창에서 로그인한 학교가 변경되었습니다. 해당 학교로 다시 로그인해 주세요.", 409, "SCHOOL_CHANGED");
    }
  }
}

async function sportsForTournament(db: D1Database, tournamentId: string, activeOnly = true, schoolLevel?: SchoolLevel) {
  const sportsResult = await db.prepare(
    `SELECT id, name, display_order AS displayOrder,
       team_count_enabled AS teamCountEnabled,
       max_teams_per_school AS maxTeamsPerSchool,
       max_teams_per_division AS maxTeamsPerDivision, active
     FROM sports WHERE tournament_id = ? ${activeOnly ? "AND active = 1" : ""}
     ORDER BY display_order, name`,
  ).bind(tournamentId).all<SportRow>();
  const sportIds = sportsResult.results.map((sport) => sport.id);
  if (!sportIds.length) return [];
  const placeholders = sportIds.map(() => "?").join(",");
  const divisionsResult = await db.prepare(
    `SELECT id, sport_id AS sportId, name, school_level AS schoolLevel, display_order AS displayOrder, active
     FROM divisions WHERE sport_id IN (${placeholders}) ${activeOnly ? "AND active = 1" : ""}
     ORDER BY display_order, name`,
  ).bind(...sportIds).all<DivisionRow>();
  return sportsResult.results.map((sport) => ({
    id: sport.id,
    name: sport.name,
    displayOrder: Number(sport.displayOrder),
    teamCountEnabled: Boolean(sport.teamCountEnabled),
    maxTeamsPerSchool: Number(sport.maxTeamsPerSchool),
    maxTeamsPerDivision: Number(sport.maxTeamsPerDivision),
    active: Boolean(sport.active),
    divisions: divisionsResult.results
      .filter((division) => division.sportId === sport.id && (!schoolLevel || division.schoolLevel === schoolLevel))
      .map((division) => ({
        id: division.id,
        name: division.name,
        schoolLevel: division.schoolLevel,
        displayOrder: Number(division.displayOrder),
        active: Boolean(division.active),
      })),
  })).filter((sport) => !schoolLevel || sport.divisions.length > 0);
}

async function eligibleSchools(db: D1Database, tournament: TournamentRow | null) {
  const levels = schoolLevels(tournament?.schoolLevels);
  return db.prepare(
    `SELECT id, name, school_level AS schoolLevel, display_order AS displayOrder FROM schools
     WHERE active = 1 AND school_level IN (${levels.map(() => "?").join(",")})
       AND (eligible_from IS NULL OR julianday(eligible_from) < julianday(?))
     ORDER BY CASE school_level WHEN 'elementary' THEN 0 ELSE 1 END, display_order, name`,
  ).bind(...levels, tournament?.surveyEnd ?? "0001-01-01").all<{ id: string; name: string; schoolLevel: SchoolLevel; displayOrder: number }>();
}

async function publicBootstrap(request: Request, db: D1Database) {
  const { tournament, tournaments, defaultEventId } = await publishedTournamentSelection(db, new URL(request.url).searchParams.get("tournamentId"));
  const [schoolResult, sports] = await Promise.all([
    tournament ? eligibleSchools(db, tournament) : { results: [] },
    tournament ? sportsForTournament(db, tournament.id, true) : [],
  ]);
  return {
    title: "동부교육지원청 학교스포츠클럽대회 참가 신청",
    tournament,
    tournaments,
    defaultEventId,
    surveyState: tournamentState(tournament),
    schools: schoolResult.results.map((school) => ({ ...school, displayOrder: Number(school.displayOrder) })),
    sports,
  };
}

async function getSurvey(db: D1Database, tournamentId: string, schoolId: string) {
  const response = await db.prepare(
    `SELECT no_participation AS noParticipation, revision, updated_at AS updatedAt
     FROM responses WHERE tournament_id = ? AND school_id = ?`,
  ).bind(tournamentId, schoolId).first<{ noParticipation: number; revision: number; updatedAt: string }>();
  const items = response
    ? await db.prepare(
      `SELECT division_id AS divisionId, team_count AS teamCount
       FROM response_items WHERE tournament_id = ? AND school_id = ?`,
    ).bind(tournamentId, schoolId).all<{ divisionId: string; teamCount: number }>()
    : { results: [] as Array<{ divisionId: string; teamCount: number }> };
  return {
    submitted: Boolean(response),
    noParticipation: Boolean(response?.noParticipation),
    revision: Number(response?.revision ?? 0),
    updatedAt: response?.updatedAt ?? null,
    selections: items.results.map((item) => ({ divisionId: item.divisionId, teamCount: Number(item.teamCount) })),
  };
}

async function createSession(
  request: Request,
  db: D1Database,
  actorType: "school" | "admin",
  schoolId: string | null,
  tournamentId: string | null,
  adminAuthVersion: number | null = null,
  schoolCredential?: SchoolCredentialSnapshot,
) {
  const seconds = actorType === "school" ? SCHOOL_SESSION_SECONDS : ADMIN_SESSION_SECONDS;
  const token = randomToken();
  const expiresAt = new Date(Date.now() + seconds * 1000).toISOString();
  if (actorType === "school" && !schoolCredential) throw apiError("학교 로그인 정보를 다시 확인해 주세요.", 401, "INVALID_CREDENTIALS");
  const tokenHash = await sha256(token);
  const insertion = actorType === "school"
    ? db.prepare(
      `INSERT INTO sessions (token_hash, actor_type, school_id, tournament_id, admin_auth_version, expires_at)
       SELECT ?, 'school', ?, ?, NULL, ? WHERE EXISTS (
         SELECT 1 FROM schools sc JOIN tournaments t ON t.id = ?
         WHERE sc.id = ? AND sc.active = 1 AND sc.password_salt = ? AND sc.password_hash = ? AND sc.password_iterations = ?
           AND t.status = 'active' AND julianday(t.survey_start) <= julianday('now') AND julianday(t.survey_end) > julianday('now')
           AND sc.school_level IN (SELECT value FROM json_each(t.school_levels))
           AND (sc.eligible_from IS NULL OR julianday(sc.eligible_from) < julianday(t.survey_end))
       )`,
    ).bind(tokenHash, schoolId, tournamentId, expiresAt, tournamentId, schoolId, schoolCredential!.passwordSalt, schoolCredential!.passwordHash, schoolCredential!.passwordIterations)
    : db.prepare(
      "INSERT INTO sessions (token_hash, actor_type, school_id, tournament_id, admin_auth_version, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(tokenHash, actorType, schoolId, tournamentId, adminAuthVersion, expiresAt);
  const results = await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(new Date().toISOString()),
    insertion,
  ]);
  if (actorType === "school" && !results[1].meta.changes) {
    throw apiError("로그인 중 기관번호 또는 신청 설정이 변경되었습니다. 새로고침 후 다시 로그인해 주세요.", 401, "INVALID_CREDENTIALS");
  }
  return {
    header: sessionCookie(request, actorType === "school" ? SCHOOL_COOKIE : ADMIN_COOKIE, token, seconds),
  };
}

async function requireSession(request: Request, db: D1Database, actorType: "school" | "admin"): Promise<SessionRow> {
  const cookieName = actorType === "school" ? SCHOOL_COOKIE : ADMIN_COOKIE;
  const token = getCookie(request, cookieName);
  if (!token) throw apiError("로그인이 필요합니다.", 401, "AUTH_REQUIRED");
  const row = actorType === "admin"
    ? await db.prepare(
      `SELECT s.actor_type AS actorType, s.school_id AS schoolId, s.tournament_id AS tournamentId,
         s.admin_auth_version AS adminAuthVersion
       FROM sessions s JOIN admin_credentials c ON c.id = 1 AND c.auth_version = s.admin_auth_version
       WHERE s.token_hash = ? AND s.actor_type = 'admin' AND s.expires_at > ?`,
    ).bind(await sha256(token), new Date().toISOString()).first<SessionRow>()
    : await db.prepare(
      `SELECT actor_type AS actorType, school_id AS schoolId, tournament_id AS tournamentId,
         admin_auth_version AS adminAuthVersion
       FROM sessions WHERE token_hash = ? AND actor_type = 'school' AND expires_at > ?`,
    ).bind(await sha256(token), new Date().toISOString()).first<SessionRow>();
  if (!row) throw apiError("로그인이 만료되었습니다. 다시 로그인해 주세요.", 401, "SESSION_EXPIRED");
  return row;
}

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

async function rateLimitKey(request: Request, scope: string, subject: string): Promise<string> {
  return sha256(`${scope}|${clientIp(request)}|${subject}`);
}

async function assertNotRateLimited(db: D1Database, key: string): Promise<void> {
  const row = await db.prepare(
    "SELECT failure_count AS failureCount, window_started_at AS windowStartedAt, locked_until AS lockedUntil FROM login_attempts WHERE attempt_key = ?",
  ).bind(key).first<{ failureCount: number; windowStartedAt: string; lockedUntil: string | null }>();
  if (row?.lockedUntil && new Date(row.lockedUntil).getTime() > Date.now()) {
    throw apiError("로그인 시도가 너무 많습니다. 15분 후에 다시 시도해 주세요.", 429, "RATE_LIMITED");
  }
}

async function recordLoginFailure(db: D1Database, key: string): Promise<void> {
  const now = new Date();
  const row = await db.prepare(
    "SELECT failure_count AS failureCount, window_started_at AS windowStartedAt FROM login_attempts WHERE attempt_key = ?",
  ).bind(key).first<{ failureCount: number; windowStartedAt: string }>();
  const expiredWindow = !row || now.getTime() - new Date(row.windowStartedAt).getTime() > RATE_LIMIT_WINDOW_MS;
  const failures = expiredWindow ? 1 : Number(row.failureCount) + 1;
  const windowStartedAt = expiredWindow ? now.toISOString() : row.windowStartedAt;
  const lockedUntil = failures >= RATE_LIMIT_FAILURES ? new Date(now.getTime() + RATE_LIMIT_WINDOW_MS).toISOString() : null;
  await db.prepare(
    `INSERT INTO login_attempts (attempt_key, failure_count, window_started_at, locked_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(attempt_key) DO UPDATE SET
       failure_count = excluded.failure_count,
       window_started_at = excluded.window_started_at,
       locked_until = excluded.locked_until`,
  ).bind(key, failures, windowStartedAt, lockedUntil).run();
}

async function clearLoginFailures(db: D1Database, key: string): Promise<void> {
  await db.prepare("DELETE FROM login_attempts WHERE attempt_key = ?").bind(key).run();
}

async function schoolLogin(request: Request, env: Env): Promise<Response> {
  if (!env.SCHOOL_PASSWORD_PEPPER) {
    throw apiError("학교 로그인 보안 설정이 필요합니다.", 503, "SECRET_MISSING");
  }
  const body = await readJson<{ schoolId?: string; password?: string; tournamentId?: string }>(request);
  const { tournament } = await publishedTournamentSelection(env.DB, body.tournamentId);
  const state = tournamentState(tournament);
  if (!tournament || !state.open) throw apiError(state.message, 403, "SURVEY_CLOSED");
  const schoolId = cleanText(body.schoolId, "학교", 80);
  const password = normalizeSchoolPasswordInput(body.password);
  const key = await rateLimitKey(request, "school", schoolId);
  await assertNotRateLimited(env.DB, key);

  const school = await env.DB.prepare(
    `SELECT id, name, school_level AS schoolLevel, password_salt AS passwordSalt,
       password_hash AS passwordHash, password_iterations AS passwordIterations
     FROM schools WHERE id = ? AND active = 1 AND (eligible_from IS NULL OR julianday(eligible_from) < julianday(?))`,
  ).bind(schoolId, tournament.surveyEnd).first<{
    id: string;
    name: string;
    schoolLevel: SchoolLevel;
    passwordSalt: string;
    passwordHash: string;
    passwordIterations: number;
  }>();

  let valid = false;
  if (school && password && schoolLevels(tournament.schoolLevels).includes(school.schoolLevel)) {
    const supplied = await hashSchoolPassword(
      password,
      env.SCHOOL_PASSWORD_PEPPER,
      school.passwordSalt,
      Number(school.passwordIterations),
    );
    valid = constantTimeEqual(supplied, school.passwordHash);
  } else {
    await hashSchoolPassword(password || "invalid", env.SCHOOL_PASSWORD_PEPPER, "AAAAAAAAAAAAAAAAAAAAAA", 25_000);
  }
  if (!valid || !school) {
    await recordLoginFailure(env.DB, key);
    throw apiError("선택한 학교명 또는 비밀번호를 확인해 주세요.", 401, "INVALID_CREDENTIALS");
  }

  await clearLoginFailures(env.DB, key);
  const session = await createSession(request, env.DB, "school", school.id, tournament.id, null, school);
  const survey = await getSurvey(env.DB, tournament.id, school.id);
  return json(
    { school: { id: school.id, name: school.name, schoolLevel: school.schoolLevel }, tournament, sports: await sportsForTournament(env.DB, tournament.id, true, school.schoolLevel), survey },
    200,
    { "Set-Cookie": session.header },
  );
}

async function requireSchoolContext(request: Request, env: Env) {
  const session = await requireSession(request, env.DB, "school");
  if (!session.schoolId || !session.tournamentId) throw apiError("로그인 정보가 완전하지 않습니다.", 401, "SESSION_INVALID");
  assertExpectedTournament(request, session.tournamentId);
  assertExpectedSchool(request, session.schoolId);
  const [tournament, school] = await Promise.all([
    tournamentById(env.DB, session.tournamentId),
    env.DB.prepare(
      `SELECT sc.id, sc.name, sc.school_level AS schoolLevel,
         CASE WHEN sc.eligible_from IS NULL OR julianday(sc.eligible_from) < julianday(t.survey_end) THEN 1 ELSE 0 END AS eligible
       FROM schools sc JOIN tournaments t ON t.id = ? WHERE sc.id = ? AND sc.active = 1`,
    ).bind(session.tournamentId, session.schoolId).first<{ id: string; name: string; schoolLevel: SchoolLevel; eligible: number }>(),
  ]);
  if (!tournament) throw apiError("참가 신청를 찾을 수 없습니다.", 404, "NOT_FOUND");
  const state = tournamentState(tournament);
  if (!state.open) throw apiError(state.message, 403, "SURVEY_CLOSED");
  if (!school) throw apiError("학교 정보를 확인할 수 없습니다.", 401, "SCHOOL_INACTIVE");
  if (!schoolLevels(tournament.schoolLevels).includes(school.schoolLevel) || !school.eligible) {
    throw apiError("해당 학교는 이번 참가 신청의 대상이 아닙니다.", 403, "SCHOOL_NOT_ELIGIBLE");
  }
  return { school: { id: school.id, name: school.name, schoolLevel: school.schoolLevel }, tournament };
}

async function schoolSession(request: Request, env: Env): Promise<Response> {
  const { school, tournament } = await requireSchoolContext(request, env);
  return json({ school, tournament, sports: await sportsForTournament(env.DB, tournament.id, true, school.schoolLevel), survey: await getSurvey(env.DB, tournament.id, school.id) });
}

async function schoolParticipants(request: Request, env: Env): Promise<Response> {
  const { school, tournament } = await requireSchoolContext(request, env);
  const levels = schoolLevels(tournament.schoolLevels);
  const [sports, items] = await Promise.all([
    sportsForTournament(env.DB, tournament.id),
    env.DB.prepare(
      `SELECT s.id AS sportId, d.id AS divisionId, d.name AS divisionName,
         sc.id AS schoolId, sc.name AS schoolName, sc.school_level AS schoolLevel, ri.team_count AS teamCount
       FROM response_items ri
       JOIN responses r ON r.tournament_id = ri.tournament_id AND r.school_id = ri.school_id
       JOIN schools sc ON sc.id = ri.school_id AND sc.active = 1
       JOIN divisions d ON d.id = ri.division_id AND d.active = 1
       JOIN sports s ON s.id = d.sport_id AND s.tournament_id = ri.tournament_id AND s.active = 1
       WHERE ri.tournament_id = ? AND r.no_participation = 0 AND ri.team_count > 0
         AND sc.school_level IN (${levels.map(() => "?").join(",")}) AND d.school_level = sc.school_level
       ORDER BY CASE sc.school_level WHEN 'elementary' THEN 0 ELSE 1 END, sc.display_order, sc.name, d.display_order, d.name`,
    ).bind(tournament.id, ...levels).all<{ sportId: string; divisionId: string; divisionName: string; schoolId: string; schoolName: string; schoolLevel: SchoolLevel; teamCount: number }>(),
  ]);
  return json({
    tournamentId: tournament.id,
    queriedAt: new Date().toISOString(),
    sports: sports.map((sport) => {
      const rows = items.results.filter((row) => row.sportId === sport.id);
      const schools = [...new Set(rows.map((row) => row.schoolId))].map((schoolId) => {
        const selections = rows.filter((row) => row.schoolId === schoolId);
        return {
          schoolId, schoolName: selections[0].schoolName, schoolLevel: selections[0].schoolLevel, isOwnSchool: schoolId === school.id,
          teamCount: selections.reduce((sum, row) => sum + Number(row.teamCount), 0),
          selections: selections.map((row) => ({ divisionId: row.divisionId, divisionName: row.divisionName, teamCount: Number(row.teamCount) })),
        };
      });
      return {
        id: sport.id, name: sport.name, schools, schoolCount: schools.length,
        teamCount: schools.reduce((sum, row) => sum + row.teamCount, 0),
        divisions: sport.divisions.map((division) => {
          const selected = rows.filter((row) => row.divisionId === division.id);
          return { id: division.id, name: division.name, schoolLevel: division.schoolLevel, schoolCount: selected.length, teamCount: selected.reduce((sum, row) => sum + Number(row.teamCount), 0) };
        }),
      };
    }),
  });
}

async function saveSurvey(request: Request, env: Env): Promise<Response> {
  const { school, tournament: current } = await requireSchoolContext(request, env);

  const body = await readJson<{
    tournamentId?: string;
    schoolId?: string;
    revision?: number;
    noParticipation?: boolean;
    selections?: Array<{ divisionId?: string; teamCount?: number }>;
  }>(request);
  if (typeof body.tournamentId !== "string" || !body.tournamentId || typeof body.schoolId !== "string" || !body.schoolId) {
    throw apiError("안전한 신청 저장을 위해 페이지를 새로고침한 후 다시 로그인해 주세요.", 409, "EVENT_CHANGED");
  }
  assertExpectedTournament(request, current.id, body.tournamentId);
  assertExpectedSchool(request, school.id, body.schoolId);
  const noParticipation = body.noParticipation === true;
  const selections = Array.isArray(body.selections) ? body.selections : [];
  if (selections.length > 30) throw apiError("선택한 종별이 너무 많습니다.");
  if (noParticipation && selections.length) throw apiError("참가 신청 없음과 참가 종목을 함께 선택할 수 없습니다.");
  if (!noParticipation && !selections.length) throw apiError("참가 종목을 선택하거나 '참가 신청 없음'을 선택해 주세요.");

  const validRows = await env.DB.prepare(
    `SELECT d.id AS divisionId, d.name AS divisionName,
       s.id AS sportId, s.name AS sportName,
       s.max_teams_per_school AS maxTeamsPerSchool,
       s.max_teams_per_division AS maxTeamsPerDivision
     FROM divisions d JOIN sports s ON s.id = d.sport_id
     WHERE s.tournament_id = ? AND s.active = 1 AND d.active = 1 AND d.school_level = ?`,
  ).bind(current.id, school.schoolLevel).all<{
    divisionId: string;
    divisionName: string;
    sportId: string;
    sportName: string;
    maxTeamsPerSchool: number;
    maxTeamsPerDivision: number;
  }>();
  const allowed = new Map(validRows.results.map((row) => [row.divisionId, row]));
  const normalized: Array<{ divisionId: string; teamCount: number; sportId: string }> = [];
  const seen = new Set<string>();
  const totals = new Map<string, number>();
  for (const item of selections) {
    const divisionId = String(item.divisionId ?? "");
    const rule = allowed.get(divisionId);
    if (!rule || seen.has(divisionId)) throw apiError("종목·종별 선택을 다시 확인해 주세요.");
    seen.add(divisionId);
    const validated = validateTeamSelection({
      sportName: rule.sportName,
      divisionName: rule.divisionName,
      requestedCount: item.teamCount ?? 1,
      currentSportTotal: totals.get(rule.sportId) ?? 0,
      maxTeamsPerSchool: Number(rule.maxTeamsPerSchool),
      maxTeamsPerDivision: Number(rule.maxTeamsPerDivision),
    });
    if (validated.error) throw apiError(validated.error.message, 400, validated.error.code);
    totals.set(rule.sportId, validated.value.sportTotal);
    normalized.push({ divisionId, teamCount: validated.value.teamCount, sportId: rule.sportId });
  }

  const existing = await env.DB.prepare(
    "SELECT revision FROM responses WHERE tournament_id = ? AND school_id = ?",
  ).bind(current.id, school.id).first<{ revision: number }>();
  const currentRevision = Number(existing?.revision ?? 0);
  const suppliedRevision = Number(body.revision ?? 0);
  if (!Number.isInteger(suppliedRevision) || suppliedRevision !== currentRevision) {
    throw apiError("다른 창에서 신청 내용이 변경되었습니다. 최신 내용을 다시 불러와 주세요.", 409, "REVISION_CONFLICT");
  }
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO responses (tournament_id, school_id, no_participation, revision)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(tournament_id, school_id) DO UPDATE SET
         no_participation = excluded.no_participation,
         revision = responses.revision + 1,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(current.id, school.id, noParticipation ? 1 : 0),
    env.DB.prepare("DELETE FROM response_items WHERE tournament_id = ? AND school_id = ?").bind(current.id, school.id),
    ...normalized.map((item) => env.DB.prepare(
      "INSERT INTO response_items (tournament_id, school_id, division_id, team_count) VALUES (?, ?, ?, ?)",
    ).bind(current.id, school.id, item.divisionId, item.teamCount)),
  ];
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/SURVEY_NOT_WRITABLE/iu.test(message)) {
      throw apiError("저장 직전에 신청 기간 또는 공개·대상 학교 설정이 변경되었습니다. 새로고침 후 신청 상태를 확인해 주세요.", 403, "SURVEY_CLOSED");
    }
    if (/DIVISION_TEAM_LIMIT_EXCEEDED/iu.test(message)) {
      throw apiError("저장 직전에 한 종별 최대 팀 수가 변경되었습니다. 최신 화면에서 팀 수를 다시 확인해 주세요.", 409, "TEAM_LIMIT_CHANGED");
    }
    if (/SCHOOL_TEAM_LIMIT_EXCEEDED/iu.test(message)) {
      throw apiError("저장 직전에 학교 전체 최대 팀 수가 변경되었습니다. 최신 화면에서 팀 수를 다시 확인해 주세요.", 409, "TEAM_LIMIT_CHANGED");
    }
    if (/INVALID_TEAM_COUNT|INVALID_DIVISION/iu.test(message)) {
      throw apiError("저장 직전에 종목 설정이 변경되었습니다. 최신 화면에서 다시 신청해 주세요.", 409, "SPORT_CONFIGURATION_CHANGED");
    }
    throw error;
  }
  const saved = await getSurvey(env.DB, current.id, school.id);
  return json({ ok: true, survey: saved });
}

async function logout(request: Request, env: Env, actorType: "school" | "admin"): Promise<Response> {
  const cookieName = actorType === "school" ? SCHOOL_COOKIE : ADMIN_COOKIE;
  const token = getCookie(request, cookieName);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie(request, cookieName) });
}

async function storedAdminCredential(db: D1Database): Promise<AdminCredentialRow | null> {
  return db.prepare(
    `SELECT username, password_algorithm AS passwordAlgorithm, password_salt AS passwordSalt,
       password_hash AS passwordHash, password_iterations AS passwordIterations,
       auth_version AS authVersion
     FROM admin_credentials WHERE id = 1`,
  ).first<AdminCredentialRow>();
}

function requireAdminPepper(env: Env): string {
  if (!env.SCHOOL_PASSWORD_PEPPER) {
    throw apiError("관리자 보안 설정이 필요합니다.", 503, "ADMIN_SECRET_MISSING");
  }
  return env.SCHOOL_PASSWORD_PEPPER;
}

async function verifyStoredAdminPassword(
  credential: AdminCredentialRow,
  password: string,
  pepper: string,
): Promise<boolean> {
  if (credential.passwordAlgorithm !== ADMIN_PASSWORD_ALGORITHM) {
    throw apiError("지원하지 않는 관리자 보안 형식입니다.", 503, "ADMIN_ALGORITHM_UNSUPPORTED");
  }
  const iterations = Number(credential.passwordIterations);
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 2_000_000
    || !/^[A-Za-z0-9_-]{22,86}$/u.test(credential.passwordSalt)
    || !/^[A-Za-z0-9_-]{43}$/u.test(credential.passwordHash)) {
    throw apiError("관리자 계정 보안 정보를 확인할 수 없습니다.", 503, "ADMIN_CREDENTIAL_INVALID");
  }
  const supplied = await hashAdminPassword(
    password,
    pepper,
    credential.passwordSalt,
    iterations,
  );
  return constantTimeEqual(supplied, credential.passwordHash);
}

async function bootstrapAdminCredential(
  env: Env,
  username: string,
  password: string,
  pepper: string,
): Promise<AdminCredentialRow | null> {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
    throw apiError("관리자 보안 설정이 필요합니다.", 503, "ADMIN_SECRET_MISSING");
  }
  const validUsername = constantTimeEqual(username, env.ADMIN_USERNAME.normalize("NFC"));
  const validPassword = constantTimeEqual(password, env.ADMIN_PASSWORD.normalize("NFC"));
  if (!validUsername || !validPassword) {
    await hashAdminPassword(password, pepper, "AAAAAAAAAAAAAAAAAAAAAA", ADMIN_PASSWORD_ITERATIONS);
    return null;
  }

  const salt = randomToken(16);
  const passwordHash = await hashAdminPassword(password, pepper, salt, ADMIN_PASSWORD_ITERATIONS);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO admin_credentials
       (id, username, password_algorithm, password_salt, password_hash, password_iterations, auth_version)
     VALUES (1, ?, ?, ?, ?, ?, 1)`,
  ).bind(username, ADMIN_PASSWORD_ALGORITHM, salt, passwordHash, ADMIN_PASSWORD_ITERATIONS).run();

  const credential = await storedAdminCredential(env.DB);
  if (!credential) throw apiError("관리자 계정 정보를 저장하지 못했습니다.", 500, "ADMIN_BOOTSTRAP_FAILED");
  const validStoredUsername = constantTimeEqual(username, credential.username);
  const validStoredPassword = await verifyStoredAdminPassword(credential, password, pepper);
  return validStoredUsername && validStoredPassword ? credential : null;
}

async function adminLogin(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ username?: string; password?: string }>(request);
  const username = String(body.username ?? "").trim().normalize("NFC");
  const password = String(body.password ?? "").normalize("NFC");
  const key = await rateLimitKey(request, "admin", "account");
  await assertNotRateLimited(env.DB, key);
  const pepper = requireAdminPepper(env);
  let credential = await storedAdminCredential(env.DB);
  if (credential) {
    const validPassword = await verifyStoredAdminPassword(credential, password, pepper);
    if (!constantTimeEqual(username, credential.username) || !validPassword) credential = null;
  } else {
    credential = await bootstrapAdminCredential(env, username, password, pepper);
  }
  if (!credential) {
    await recordLoginFailure(env.DB, key);
    throw apiError("관리자 아이디 또는 비밀번호를 확인해 주세요.", 401, "INVALID_CREDENTIALS");
  }
  await clearLoginFailures(env.DB, key);
  const session = await createSession(request, env.DB, "admin", null, null, Number(credential.authVersion));
  return json({ ok: true }, 200, { "Set-Cookie": session.header });
}

function adminUsername(value: unknown): string {
  const username = String(value ?? "").trim().normalize("NFC");
  if (username.length < 3 || username.length > 40 || !/^[\p{L}\p{N}._-]+$/u.test(username)) {
    throw apiError("관리자 아이디는 공백 없이 3~40자로 입력해 주세요.", 400, "INVALID_USERNAME");
  }
  return username;
}

function adminPasswordLength(value: string): number {
  return [...value].length;
}

async function updateAdminCredentials(request: Request, env: Env): Promise<Response> {
  await requireSession(request, env.DB, "admin");
  const credential = await storedAdminCredential(env.DB);
  if (!credential) throw apiError("관리자 계정 정보를 확인할 수 없습니다.", 401, "SESSION_INVALID");

  const body = await readJson<{
    username?: string;
    currentPassword?: string;
    newPassword?: string;
    newPasswordConfirm?: string;
  }>(request);
  const username = adminUsername(body.username);
  const currentPassword = String(body.currentPassword ?? "").normalize("NFC");
  const newPassword = String(body.newPassword ?? "").normalize("NFC");
  const newPasswordConfirm = String(body.newPasswordConfirm ?? "").normalize("NFC");
  if (!currentPassword) {
    throw apiError("현재 비밀번호를 입력해 주세요.", 400, "CURRENT_PASSWORD_REQUIRED");
  }
  if (newPassword) {
    const length = adminPasswordLength(newPassword);
    if (length < ADMIN_PASSWORD_MIN_LENGTH || length > ADMIN_PASSWORD_MAX_LENGTH) {
      throw apiError(
        `새 비밀번호는 ${ADMIN_PASSWORD_MIN_LENGTH}~${ADMIN_PASSWORD_MAX_LENGTH}자로 입력해 주세요.`,
        400,
        "INVALID_NEW_PASSWORD",
      );
    }
    if (!constantTimeEqual(newPassword, newPasswordConfirm)) {
      throw apiError("새 비밀번호가 서로 일치하지 않습니다.", 400, "PASSWORD_MISMATCH");
    }
  } else if (newPasswordConfirm) {
    throw apiError("새 비밀번호가 서로 일치하지 않습니다.", 400, "PASSWORD_MISMATCH");
  }

  const usernameChanged = !constantTimeEqual(username, credential.username);
  const passwordChanged = Boolean(newPassword);
  if (!usernameChanged && !passwordChanged) {
    throw apiError("변경할 아이디 또는 새 비밀번호를 입력해 주세요.", 400, "NO_CHANGES");
  }

  const key = await rateLimitKey(request, "admin-credentials", "account");
  await assertNotRateLimited(env.DB, key);
  const validCurrentPassword = await verifyStoredAdminPassword(
    credential,
    currentPassword,
    requireAdminPepper(env),
  );
  if (!validCurrentPassword) {
    await recordLoginFailure(env.DB, key);
    throw apiError("현재 비밀번호가 올바르지 않습니다.", 401, "INVALID_CURRENT_PASSWORD");
  }
  await clearLoginFailures(env.DB, key);

  let passwordAlgorithm = credential.passwordAlgorithm;
  let passwordSalt = credential.passwordSalt;
  let passwordHash = credential.passwordHash;
  let passwordIterations = Number(credential.passwordIterations);
  if (passwordChanged) {
    passwordAlgorithm = ADMIN_PASSWORD_ALGORITHM;
    passwordSalt = randomToken(16);
    passwordIterations = ADMIN_PASSWORD_ITERATIONS;
    passwordHash = await hashAdminPassword(newPassword, requireAdminPepper(env), passwordSalt, passwordIterations);
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE admin_credentials SET username = ?, password_algorithm = ?, password_salt = ?,
         password_hash = ?, password_iterations = ?, auth_version = auth_version + 1,
         updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
    ).bind(username, passwordAlgorithm, passwordSalt, passwordHash, passwordIterations),
    env.DB.prepare("DELETE FROM sessions WHERE actor_type = 'admin'"),
    auditStatement(env.DB, "UPDATE", "admin_account", "1", {
      previousUsername: credential.username,
      nextUsername: username,
      usernameChanged,
      passwordChanged,
    }),
  ]);
  return json(
    { ok: true },
    200,
    { "Set-Cookie": clearCookie(request, ADMIN_COOKIE) },
  );
}

async function adminDashboard(request: Request, env: Env): Promise<Response> {
  await requireSession(request, env.DB, "admin");
  const credential = await storedAdminCredential(env.DB);
  if (!credential) throw apiError("관리자 계정 정보를 확인할 수 없습니다.", 401, "SESSION_INVALID");
  const eventId = new URL(request.url).searchParams.get("eventId");
  const eventsResult = await env.DB.prepare(
    `SELECT id, academic_year AS academicYear, name, survey_start AS surveyStart,
       survey_end AS surveyEnd, status, card_copy AS cardCopy, header_copy AS headerCopy, logo_key AS logoKey, school_levels AS schoolLevels FROM tournaments ORDER BY academic_year DESC, created_at DESC`,
  ).all<TournamentRow>();
  const active = await activeTournament(env.DB);
  const selectedId = eventId && eventsResult.results.some((event) => event.id === eventId)
    ? eventId
    : active?.id ?? eventsResult.results[0]?.id ?? null;
  const selectedEvent = selectedId ? eventsResult.results.find((event) => event.id === selectedId) ?? null : null;
  if (!selectedId || !selectedEvent) {
    return json({ adminUsername: credential.username, events: eventsResult.results, selectedEvent: null, sports: [], schools: [], rows: [] });
  }
  const [sports, schoolsResult, responsesResult, itemsResult] = await Promise.all([
    sportsForTournament(env.DB, selectedId, false),
    eligibleSchools(env.DB, selectedEvent),
    env.DB.prepare(
      `SELECT school_id AS schoolId, no_participation AS noParticipation,
         revision, updated_at AS updatedAt FROM responses WHERE tournament_id = ?`,
    ).bind(selectedId).all<{ schoolId: string; noParticipation: number; revision: number; updatedAt: string }>(),
    env.DB.prepare(
      `SELECT school_id AS schoolId, division_id AS divisionId, team_count AS teamCount
       FROM response_items WHERE tournament_id = ?`,
    ).bind(selectedId).all<{ schoolId: string; divisionId: string; teamCount: number }>(),
  ]);
  const responseMap = new Map(responsesResult.results.map((response) => [response.schoolId, response]));
  const rows = schoolsResult.results.map((school) => {
    const response = responseMap.get(school.id);
    return {
      school: { ...school, displayOrder: Number(school.displayOrder) },
      submitted: Boolean(response),
      noParticipation: Boolean(response?.noParticipation),
      revision: Number(response?.revision ?? 0),
      updatedAt: response?.updatedAt ?? null,
      selections: itemsResult.results
        .filter((item) => item.schoolId === school.id)
        .map((item) => ({ divisionId: item.divisionId, teamCount: Number(item.teamCount) })),
    };
  });
  return json({
    adminUsername: credential.username,
    defaultEventId: active?.id ?? null,
    events: eventsResult.results,
    selectedEvent,
    surveyState: tournamentState(selectedEvent),
    sports,
    rows,
  });
}

async function adminSchools(request: Request, env: Env): Promise<Response> {
  await requireSession(request, env.DB, "admin");
  const result = await env.DB.prepare(
    `SELECT id, name, school_level AS schoolLevel, display_order AS displayOrder, active, created_at AS createdAt
     FROM schools ORDER BY CASE school_level WHEN 'elementary' THEN 0 ELSE 1 END, display_order, name`,
  ).all<{ id: string; name: string; schoolLevel: SchoolLevel; displayOrder: number; active: number; createdAt: string }>();
  return json({ schools: result.results.map((school) => ({ ...school, active: Boolean(school.active), displayOrder: Number(school.displayOrder) })) });
}

function institutionCodeInput(value: unknown, level: SchoolLevel): string {
  if (typeof value !== "string" || value.length > 40) throw apiError("학교 기관번호를 확인해 주세요.", 400, "INVALID_INSTITUTION_CODE");
  const code = normalizeSchoolPasswordInput(value);
  const pattern = level === "elementary" ? /^동(?:나|너)\d{2,4}$/u : /^동(?:다|더)\d{2,4}$/u;
  if (!pattern.test(code)) throw apiError(level === "elementary" ? "초등학교 기관번호는 동나 또는 동너 뒤 숫자 2~4자리로 입력해 주세요." : "중학교 기관번호는 동다 또는 동더 뒤 숫자 2~4자리로 입력해 주세요.", 400, "INVALID_INSTITUTION_CODE");
  return code;
}

async function institutionFingerprint(code: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`school-institution-v1|${code}`))));
}

async function assertInstitutionCodeAvailable(env: Env, code: string, level: SchoolLevel, fingerprint: string, excludeId = "") {
  if (await env.DB.prepare("SELECT id FROM schools WHERE institution_fingerprint = ? AND id <> ?").bind(fingerprint, excludeId).first()) {
    throw apiError("이미 등록된 학교 기관번호입니다. 기관번호를 다시 확인해 주세요.", 409, "DUPLICATE_INSTITUTION_CODE");
  }
  // Legacy records have individually salted hashes, never recoverable institution codes.
  // Verify against those hashes before writing; no codes enter audit records or responses.
  const existing = await env.DB.prepare(
    `SELECT password_salt AS passwordSalt, password_hash AS passwordHash, password_iterations AS passwordIterations
     FROM schools WHERE school_level = ? AND id <> ?`,
  ).bind(level, excludeId).all<SchoolCredentialSnapshot>();
  for (let offset = 0; offset < existing.results.length; offset += 8) {
    const duplicate = await Promise.all(existing.results.slice(offset, offset + 8).map(async (school) => constantTimeEqual(
      await hashSchoolPassword(code, env.SCHOOL_PASSWORD_PEPPER!, school.passwordSalt, Number(school.passwordIterations)), school.passwordHash,
    )));
    if (duplicate.some(Boolean)) throw apiError("이미 등록된 학교 기관번호입니다. 기관번호를 다시 확인해 주세요.", 409, "DUPLICATE_INSTITUTION_CODE");
  }
}

async function addSchool(request: Request, env: Env): Promise<Response> {
  await requireSession(request, env.DB, "admin");
  if (!env.SCHOOL_PASSWORD_PEPPER) throw apiError("학교 로그인 보안 설정이 필요합니다.", 503, "SECRET_MISSING");
  const body = await readJson<{ name?: unknown; schoolLevel?: unknown; institutionCode?: unknown }>(request);
  if (typeof body.name !== "string") throw apiError("학교명을 입력해 주세요.");
  const name = cleanText(body.name, "학교명", 80);
  if (/[\u0000-\u001f\u007f]/u.test(name)) throw apiError("학교명에는 줄바꿈이나 제어 문자를 사용할 수 없습니다.");
  const level = body.schoolLevel;
  if (level !== "elementary" && level !== "middle") throw apiError("학교급을 선택해 주세요.", 400, "INVALID_SCHOOL_LEVEL");
  const code = institutionCodeInput(body.institutionCode, level);
  if (await env.DB.prepare("SELECT id FROM schools WHERE name = ?").bind(name).first()) throw apiError("같은 이름의 학교가 이미 등록되어 있습니다.", 409, "DUPLICATE_SCHOOL");

  const pepper = env.SCHOOL_PASSWORD_PEPPER;
  const fingerprint = await institutionFingerprint(code, pepper);
  await assertInstitutionCodeAvailable(env, code, level, fingerprint);
  // Identity is stable and independent from the mutable credential fingerprint.
  const id = `school-custom-${crypto.randomUUID()}`;
  const salt = randomToken(16);
  const hash = await hashSchoolPassword(code, pepper, salt, 25_000);
  const createdAt = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO schools (id, name, school_level, display_order, password_salt, password_hash, password_iterations, institution_fingerprint, eligible_from, created_at, updated_at)
         SELECT ?, ?, ?, COALESCE(MAX(display_order), 0) + 1, ?, ?, 25000, ?, ?, ?, ? FROM schools WHERE school_level = ?`,
      ).bind(id, name, level, salt, hash, fingerprint, createdAt, createdAt, createdAt, level),
      auditStatement(env.DB, "CREATE", "school", id, { name, schoolLevel: level }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/UNIQUE constraint failed: schools\.institution_fingerprint/iu.test(message)) throw apiError("이미 등록된 학교 기관번호입니다. 기관번호를 다시 확인해 주세요.", 409, "DUPLICATE_INSTITUTION_CODE");
    if (/UNIQUE constraint failed: schools\.name/iu.test(message)) throw apiError("같은 이름의 학교가 이미 등록되어 있습니다.", 409, "DUPLICATE_SCHOOL");
    if (/UNIQUE constraint failed/iu.test(message)) throw apiError("다른 관리자가 학교를 추가했습니다. 새로고침 후 다시 시도해 주세요.", 409, "SCHOOL_ORDER_CONFLICT");
    throw apiError("학교를 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503, "SAVE_FAILED");
  }
  const school = await env.DB.prepare("SELECT id, name, school_level AS schoolLevel, display_order AS displayOrder, created_at AS createdAt FROM schools WHERE id = ?").bind(id).first();
  return json({ ok: true, id, school }, 201);
}

async function updateSchoolInstitutionCode(request: Request, env: Env, schoolId: string): Promise<Response> {
  await requireSession(request, env.DB, "admin");
  if (!env.SCHOOL_PASSWORD_PEPPER) throw apiError("학교 로그인 보안 설정이 필요합니다.", 503, "SECRET_MISSING");
  const id = cleanText(schoolId, "학교", 80);
  const school = await env.DB.prepare(
    `SELECT id, name, school_level AS schoolLevel, display_order AS displayOrder,
       password_salt AS passwordSalt, password_hash AS passwordHash, password_iterations AS passwordIterations
     FROM schools WHERE id = ?`,
  ).bind(id).first<SchoolCredentialSnapshot & { id: string; name: string; schoolLevel: SchoolLevel; displayOrder: number }>();
  if (!school) throw apiError("학교를 찾을 수 없습니다.", 404, "NOT_FOUND");
  const body = await readJson<{ institutionCode?: unknown }>(request);
  const code = institutionCodeInput(body.institutionCode, school.schoolLevel);
  const pepper = env.SCHOOL_PASSWORD_PEPPER;
  const publicSchool = { id: school.id, name: school.name, schoolLevel: school.schoolLevel, displayOrder: Number(school.displayOrder) };
  const unchanged = constantTimeEqual(await hashSchoolPassword(code, pepper, school.passwordSalt, Number(school.passwordIterations)), school.passwordHash);
  if (unchanged) {
    const current = await env.DB.prepare("SELECT id FROM schools WHERE id = ? AND password_salt = ? AND password_hash = ? AND password_iterations = ?")
      .bind(id, school.passwordSalt, school.passwordHash, school.passwordIterations).first();
    if (!current) throw apiError("다른 관리자가 기관번호를 변경했습니다. 새로고침 후 다시 확인해 주세요.", 409, "SCHOOL_CREDENTIAL_CHANGED");
    return json({ ok: true, changed: false, school: publicSchool, sessionsRevoked: 0 });
  }
  const fingerprint = await institutionFingerprint(code, pepper);
  await assertInstitutionCodeAvailable(env, code, school.schoolLevel, fingerprint, id);
  const salt = randomToken(16);
  const hash = await hashSchoolPassword(code, pepper, salt, 25_000);
  let results: D1Result[];
  try {
    results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE schools SET password_salt = ?, password_hash = ?, password_iterations = 25000,
           institution_fingerprint = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND password_salt = ? AND password_hash = ? AND password_iterations = ?`,
      ).bind(salt, hash, fingerprint, id, school.passwordSalt, school.passwordHash, school.passwordIterations),
      env.DB.prepare(
        `INSERT INTO admin_audit_logs (id, action, entity_type, entity_id, detail)
         SELECT ?, 'UPDATE', 'school_institution_code', ?, json_object('sessionsRevoked', (
           SELECT COUNT(*) FROM sessions WHERE actor_type = 'school' AND school_id = ?
         )) WHERE EXISTS (SELECT 1 FROM schools WHERE id = ? AND password_salt = ? AND password_hash = ?)`,
      ).bind(crypto.randomUUID(), id, id, id, salt, hash),
      env.DB.prepare(
        `DELETE FROM sessions WHERE actor_type = 'school' AND school_id = ?
         AND EXISTS (SELECT 1 FROM schools WHERE id = ? AND password_salt = ? AND password_hash = ?)`,
      ).bind(id, id, salt, hash),
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: schools\.institution_fingerprint/iu.test(error.message)) {
      throw apiError("이미 등록된 학교 기관번호입니다. 기관번호를 다시 확인해 주세요.", 409, "DUPLICATE_INSTITUTION_CODE");
    }
    throw apiError("기관번호를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503, "SAVE_FAILED");
  }
  if (!results[0].meta.changes) throw apiError("다른 관리자가 기관번호를 변경했습니다. 새로고침 후 다시 확인해 주세요.", 409, "SCHOOL_CREDENTIAL_CHANGED");
  return json({ ok: true, changed: true, school: publicSchool, sessionsRevoked: Number(results[2].meta.changes) });
}

function auditStatement(db: D1Database, action: string, entityType: string, entityId: string | null, detail: unknown) {
  return db.prepare(
    "INSERT INTO admin_audit_logs (id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), action, entityType, entityId, JSON.stringify(detail).slice(0, 2000));
}

async function audit(db: D1Database, action: string, entityType: string, entityId: string | null, detail: unknown) {
  await auditStatement(db, action, entityType, entityId, detail).run();
}

function validateEventPayload(body: { academicYear?: number; name?: string; surveyStart?: string; surveyEnd?: string }) {
  const academicYear = Number(body.academicYear);
  if (!Number.isInteger(academicYear) || academicYear < 2020 || academicYear > 2100) {
    throw apiError("학년도를 확인해 주세요.");
  }
  const name = cleanText(body.name, "대회명", 100);
  const surveyStart = parseIsoDate(body.surveyStart, "신청 시작 일시");
  const surveyEnd = parseIsoDate(body.surveyEnd, "신청 종료 일시");
  if (new Date(surveyStart).getTime() >= new Date(surveyEnd).getTime()) {
    throw apiError("종료 일시는 시작 일시보다 나중이어야 합니다.");
  }
  return { academicYear, name, surveyStart, surveyEnd };
}

function eventSchoolLevels(value: unknown): SchoolLevel[] {
  try { return validateSchoolLevels(value) as SchoolLevel[]; }
  catch (error) { throw apiError(error instanceof Error ? error.message : "참가 대상 학교급을 확인해 주세요.", 400, "INVALID_SCHOOL_LEVELS"); }
}

function defaultSportsStatements(db: D1Database, tournamentId: string, levels: SchoolLevel[]): D1PreparedStatement[] {
  const definitions = [
    { name: "배구", maxTeamsPerSchool: 2, maxTeamsPerDivision: 2 },
    { name: "3x3 농구", maxTeamsPerSchool: 2, maxTeamsPerDivision: 1 },
    { name: "피구", maxTeamsPerSchool: 2, maxTeamsPerDivision: 1 },
  ];
  const statements: D1PreparedStatement[] = [];
  definitions.forEach((definition, index) => {
    const sportId = crypto.randomUUID();
    statements.push(db.prepare(
      `INSERT INTO sports
         (id, tournament_id, name, display_order, team_count_enabled, max_teams_per_school, max_teams_per_division)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      sportId,
      tournamentId,
      definition.name,
      index + 1,
      definition.maxTeamsPerDivision >= 2 ? 1 : 0,
      definition.maxTeamsPerSchool,
      definition.maxTeamsPerDivision,
    ));
    const defaults = SCHOOL_LEVELS.filter((level) => levels.includes(level.value as SchoolLevel))
      .flatMap((level) => [level.maleDivision, level.femaleDivision].map((name) => ({ name, schoolLevel: level.value })));
    defaults.forEach((division, divisionIndex) => {
      statements.push(db.prepare(
        "INSERT INTO divisions (id, sport_id, name, school_level, display_order) VALUES (?, ?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), sportId, division.name, division.schoolLevel, divisionIndex + 1));
    });
  });
  return statements;
}

async function createEvent(request: Request, env: Env): Promise<Response> {
  await requireSession(request, env.DB, "admin");
  const body = await readJson<{ academicYear?: number; name?: string; surveyStart?: string; surveyEnd?: string; schoolLevels?: unknown }>(request);
  const payload = validateEventPayload(body);
  const levels = body.schoolLevels === undefined ? ["middle"] as SchoolLevel[] : eventSchoolLevels(body.schoolLevels);
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO tournaments (id, academic_year, name, survey_start, survey_end, school_levels, status) VALUES (?, ?, ?, ?, ?, ?, 'draft')",
    ).bind(id, payload.academicYear, payload.name, payload.surveyStart, payload.surveyEnd, JSON.stringify(levels)),
    ...defaultSportsStatements(env.DB, id, levels),
    auditStatement(env.DB, "CREATE", "tournament", id, { ...payload, schoolLevels: levels }),
  ]);
  return json({ ok: true, id }, 201);
}

async function updateEvent(request: Request, env: Env, eventId: string): Promise<Response> {
  await requireSession(request, env.DB, "admin");
  const tournament = await tournamentById(env.DB, eventId);
  if (!tournament) throw apiError("대회를 찾을 수 없습니다.", 404, "NOT_FOUND");
  const body = await readJson<{ academicYear?: number; name?: string; surveyStart?: string; surveyEnd?: string; schoolLevels?: unknown }>(request);
  if (body.schoolLevels !== undefined && JSON.stringify(eventSchoolLevels(body.schoolLevels)) !== JSON.stringify(schoolLevels(tournament.schoolLevels))) {
    throw apiError("기존 대회와 신청을 보존하기 위해 대상 학교급은 변경할 수 없습니다. 원하는 학교급으로 새 대회를 추가해 주세요.", 409, "SCHOOL_LEVELS_IMMUTABLE");
  }
  const payload = validateEventPayload(body);
  await env.DB.prepare(
    `UPDATE tournaments SET academic_year = ?, name = ?, survey_start = ?, survey_end = ?,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).bind(payload.academicYear, payload.name, payload.surveyStart, payload.surveyEnd, eventId).run();
  await audit(env.DB, "UPDATE", "tournament", eventId, payload);
  return json({ ok: true });
}

async function updateEventCard(request: Request, env: Env, eventId: string): Promise<Response> {
  await requireSession(request, env.DB, "admin");
  if (!await tournamentById(env.DB, eventId)) throw apiError("대회를 찾을 수 없습니다.", 404, "NOT_FOUND");
  const body = await readJson<{ cardCopy?: unknown }>(request);
  let copy;
  try { copy = normalizeEventCardCopy(body?.cardCopy); }
  catch (error) { throw apiError(error instanceof Error ? error.message : "안내 문구를 확인해 주세요."); }
  await env.DB.batch([
    env.DB.prepare("UPDATE tournaments SET card_copy = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(JSON.stringify(copy), eventId),
    auditStatement(env.DB, "UPDATE", "tournament_card", eventId, copy),
  ]);
  return json({ ok: true });
}

async function readLogoUpload(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "image/png") {
    throw apiError("로고는 PNG 이미지로 저장해 주세요.", 415, "UNSUPPORTED_MEDIA_TYPE");
  }
  if (Number(request.headers.get("content-length")) > MAX_LOGO_BYTES) throw apiError("로고 이미지가 너무 큽니다.", 413, "PAYLOAD_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw apiError("로고 이미지를 선택해 주세요.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_LOGO_BYTES) { await reader.cancel(); throw apiError("로고 이미지가 너무 큽니다.", 413, "PAYLOAD_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { await validateLogoPng(bytes); } catch (error) { throw apiError(error instanceof Error ? error.message : "로고 이미지를 확인해 주세요."); }
  return bytes;
}

async function updateLogoImage(request: Request, env: Env, eventId: string): Promise<Response> {
  await requireSession(request, env.DB, "admin");
  const tournament = await tournamentById(env.DB, eventId);
  if (!tournament) throw apiError("대회를 찾을 수 없습니다.", 404, "NOT_FOUND");
  const bucket = env.LOGO_FILES;
  if (!bucket) throw apiError("로고 저장소에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.", 503, "STORAGE_UNAVAILABLE");
  const logoKey = request.method === "DELETE" ? "" : crypto.randomUUID();
  if (logoKey) {
    const bytes = await readLogoUpload(request);
    try { await bucket.put(logoObjectKey(eventId, logoKey), bytes, { httpMetadata: { contentType: "image/png" } }); }
    catch { throw apiError("이미지를 저장하지 못했습니다. 기존 로고는 유지됩니다.", 503, "STORAGE_UNAVAILABLE"); }
  }
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE tournaments SET logo_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(logoKey, eventId),
      auditStatement(env.DB, logoKey ? "UPDATE" : "DELETE", "tournament_logo", eventId, { previousKey: tournament.logoKey, logoKey }),
    ]);
  } catch {
    if (logoKey) await bucket.delete(logoObjectKey(eventId, logoKey)).catch(() => {});
    throw apiError("로고 설정을 저장하지 못했습니다. 다시 시도해 주세요.", 503, "SAVE_FAILED");
  }
  // Remove only the exact previous version after the new pointer is committed.
  if (tournament.logoKey) await bucket.delete(logoObjectKey(eventId, tournament.logoKey)).catch(() => {});
  return json({ ok: true, logoKey });
}

async function getLogoImage(request: Request, env: Env, eventId: string, version: string): Promise<Response> {
  const tournament = await tournamentById(env.DB, eventId);
  if (!tournament || !tournament.logoKey || tournament.logoKey !== version) throw apiError("로고 이미지를 찾을 수 없습니다.", 404, "NOT_FOUND");
  // Draft and archived-event logos must not be exposed via a guessed URL.
  if (tournament.status !== "active") await requireSession(request, env.DB, "admin");
  if (!env.LOGO_FILES) throw apiError("로고 저장소에 연결할 수 없습니다.", 503, "STORAGE_UNAVAILABLE");
  const object = await env.LOGO_FILES.get(logoObjectKey(eventId, version));
  if (!object) throw apiError("로고 이미지를 찾을 수 없습니다.", 404, "NOT_FOUND");
  return new Response(object.body, { headers: {
    "Content-Type": "image/png", "Content-Length": String(object.size),
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Disposition": "inline; filename=logo.png",
  } });
}

async function updatePageHeader(request: Request, env: Env, eventId: string): Promise<Response> {
  await requireSession(request, env.DB, "admin");
  if (!await tournamentById(env.DB, eventId)) throw apiError("대회를 찾을 수 없습니다.", 404, "NOT_FOUND");
  const body = await readJson<{ headerCopy?: unknown }>(request);
  let copy;
  try { copy = normalizePageHeaderCopy(body?.headerCopy); }
  catch (error) { throw apiError(error instanceof Error ? error.message : "상단 문구를 확인해 주세요."); }
  await env.DB.batch([
    env.DB.prepare("UPDATE tournaments SET header_copy = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(JSON.stringify(copy), eventId),
    auditStatement(env.DB, "UPDATE", "tournament_header", eventId, copy),
  ]);
  return json({ ok: true });
}

async function activateEvent(request: Request, env: Env, eventId: string): Promise<Response> {
  await requireSession(request, env.DB, "admin");
  if (!await tournamentById(env.DB, eventId)) throw apiError("대회를 찾을 수 없습니다.", 404, "NOT_FOUND");
  await env.DB.batch([
    env.DB.prepare("UPDATE tournaments SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(eventId),
    env.DB.prepare(
      `INSERT INTO app_config (id, active_tournament_id) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET active_tournament_id = excluded.active_tournament_id, updated_at = CURRENT_TIMESTAMP`,
    ).bind(eventId),
    auditStatement(env.DB, "PUBLISH", "tournament", eventId, {}),
  ]);
  return json({ ok: true });
}

async function unpublishEvent(request: Request, env: Env, eventId: string): Promise<Response> {
  await requireSession(request, env.DB, "admin");
  if (!await tournamentById(env.DB, eventId)) throw apiError("신청를 찾을 수 없습니다.", 404, "NOT_FOUND");
  await env.DB.batch([
    env.DB.prepare("UPDATE tournaments SET status = 'draft', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(eventId),
    env.DB.prepare(
      `UPDATE app_config SET active_tournament_id = (
         SELECT id FROM tournaments WHERE status = 'active' AND id <> ?
         ORDER BY CASE WHEN julianday(survey_start) <= julianday('now') AND julianday(survey_end) > julianday('now') THEN 0 ELSE 1 END,
           academic_year DESC, created_at DESC, id LIMIT 1
       ), updated_at = CURRENT_TIMESTAMP WHERE id = 1 AND active_tournament_id = ?`,
    ).bind(eventId, eventId),
    auditStatement(env.DB, "UNPUBLISH", "tournament", eventId, {}),
  ]);
  return json({ ok: true });
}

function divisionSchoolLevel(value: unknown, tournament: TournamentRow, existing?: DivisionRow): SchoolLevel {
  const levels = schoolLevels(tournament.schoolLevels);
  const selected = value === undefined ? existing?.schoolLevel ?? (levels.length === 1 && levels[0] === "middle" ? "middle" : undefined) : value;
  if ((selected !== "elementary" && selected !== "middle") || !levels.includes(selected)) {
    throw apiError("각 종별의 학교급을 이번 대회의 참가 대상 학교급에서 선택해 주세요.", 400, "INVALID_DIVISION_SCHOOL_LEVEL");
  }
  return selected;
}

async function addSport(request: Request, env: Env): Promise<Response> {
  await requireSession(request, env.DB, "admin");
  const body = await readJson<{
    eventId?: string;
    name?: string;
    divisions?: Array<string | { name?: string; schoolLevel?: unknown }>;
    maxTeamsPerSchool?: number;
    maxTeamsPerDivision?: number;
  }>(request);
  const eventId = cleanText(body.eventId, "대회", 80);
  const tournament = await tournamentById(env.DB, eventId);
  if (!tournament) throw apiError("대회를 찾을 수 없습니다.", 404, "NOT_FOUND");
  const name = cleanText(body.name, "종목명", 40);
  if (!Array.isArray(body.divisions) || !body.divisions.length || body.divisions.length > 8) throw apiError("종별을 1개 이상 8개 이하로 입력해 주세요.");
  const requestedDivisions = body.divisions.map((division) => ({
    name: cleanText(typeof division === "string" ? division : division?.name, "종별명", 30),
    schoolLevel: divisionSchoolLevel(typeof division === "string" ? undefined : division?.schoolLevel, tournament),
  }));
  if (new Set(requestedDivisions.map((division) => division.name)).size !== requestedDivisions.length) throw apiError("같은 종별명을 두 번 사용할 수 없습니다.");
  const limitConfiguration = validateTeamLimitConfiguration(
    body.maxTeamsPerSchool ?? 2,
    body.maxTeamsPerDivision ?? 1,
  );
  if (limitConfiguration.error) throw apiError(limitConfiguration.error.message, 400, limitConfiguration.error.code);
  const { maxTeamsPerSchool, maxTeamsPerDivision, teamCountEnabled } = limitConfiguration.value;
  const maxOrder = await env.DB.prepare(
    "SELECT COALESCE(MAX(display_order), 0) AS value FROM sports WHERE tournament_id = ?",
  ).bind(eventId).first<{ value: number }>();
  const sportId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sports
         (id, tournament_id, name, display_order, team_count_enabled, max_teams_per_school, max_teams_per_division)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      sportId,
      eventId,
      name,
      Number(maxOrder?.value ?? 0) + 1,
      teamCountEnabled ? 1 : 0,
      maxTeamsPerSchool,
      maxTeamsPerDivision,
    ),
    ...requestedDivisions.map((division, index) => env.DB.prepare(
      "INSERT INTO divisions (id, sport_id, name, school_level, display_order) VALUES (?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), sportId, division.name, division.schoolLevel, index + 1)),
  ]);
  await audit(env.DB, "CREATE", "sport", sportId, {
    eventId,
    name,
    divisions: requestedDivisions,
    maxTeamsPerSchool,
    maxTeamsPerDivision,
  });
  return json({ ok: true, id: sportId }, 201);
}

async function toggleSport(request: Request, env: Env, sportId: string): Promise<Response> {
  await requireSession(request, env.DB, "admin");
  const body = await readJson<{ active?: boolean }>(request);
  if (typeof body.active !== "boolean") throw apiError("활성화 상태를 다시 확인해 주세요.");
  const sport = await env.DB.prepare(
    "SELECT id, tournament_id AS tournamentId, name, active FROM sports WHERE id = ?",
  ).bind(sportId).first<{ id: string; tournamentId: string; name: string; active: number }>();
  if (!sport) throw apiError("종목을 찾을 수 없습니다.", 404, "NOT_FOUND");
  if (!body.active && Boolean(sport.active)) {
    const [tournament, usage] = await Promise.all([
      tournamentById(env.DB, sport.tournamentId),
      env.DB.prepare(
        `SELECT COUNT(*) AS value FROM response_items ri
         JOIN divisions d ON d.id = ri.division_id WHERE d.sport_id = ?`,
      ).bind(sportId).first<{ value: number }>(),
    ]);
    if (Number(usage?.value ?? 0) > 0 && tournamentState(tournament).open) {
      throw apiError(
        "신청 기간 중에는 저장된 신청 내역이 있는 종목을 비활성화할 수 없습니다. 신청 종료 후 다시 시도해 주세요.",
        409,
        "SPORT_IN_USE",
      );
    }
  }
  const result = await env.DB.prepare("UPDATE sports SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(body.active ? 1 : 0, sportId).run();
  if (!result.meta.changes) throw apiError("종목을 찾을 수 없습니다.", 404, "NOT_FOUND");
  await audit(env.DB, body.active ? "ACTIVATE" : "DEACTIVATE", "sport", sportId, {});
  return json({ ok: true });
}

async function updateSport(request: Request, env: Env, sportId: string): Promise<Response> {
  await requireSession(request, env.DB, "admin");
  const sport = await env.DB.prepare(
    `SELECT id, tournament_id AS tournamentId, name, display_order AS displayOrder,
       team_count_enabled AS teamCountEnabled,
       max_teams_per_school AS maxTeamsPerSchool,
       max_teams_per_division AS maxTeamsPerDivision, active
     FROM sports WHERE id = ?`,
  ).bind(sportId).first<SportDetailRow>();
  if (!sport) throw apiError("종목을 찾을 수 없습니다.", 404, "NOT_FOUND");

  const tournament = await tournamentById(env.DB, sport.tournamentId);
  if (!tournament) throw apiError("대회를 찾을 수 없습니다.", 404, "NOT_FOUND");
  const body = await readJson<{
    name?: string;
    divisions?: Array<{ id?: string; name?: string; schoolLevel?: unknown }>;
    maxTeamsPerSchool?: number;
    maxTeamsPerDivision?: number;
  }>(request);
  const name = cleanText(body.name, "종목명", 40);
  const limitConfiguration = validateTeamLimitConfiguration(
    body.maxTeamsPerSchool ?? sport.maxTeamsPerSchool,
    body.maxTeamsPerDivision ?? sport.maxTeamsPerDivision,
  );
  if (limitConfiguration.error) throw apiError(limitConfiguration.error.message, 400, limitConfiguration.error.code);
  const { maxTeamsPerSchool, maxTeamsPerDivision, teamCountEnabled } = limitConfiguration.value;
  if (!Array.isArray(body.divisions) || !body.divisions.length || body.divisions.length > 8) {
    throw apiError("종별을 1개 이상 8개 이하로 입력해 주세요.");
  }

  const requestedDivisions = body.divisions.map((division) => {
    if (!division || typeof division !== "object") throw apiError("종별 정보를 다시 확인해 주세요.");
    const id = typeof division.id === "string" && division.id.trim() ? division.id.trim() : null;
    if (id && id.length > 80) throw apiError("종별 정보를 다시 확인해 주세요.");
    return { id, name: cleanText(division.name, "종별명", 30), schoolLevel: division.schoolLevel };
  });
  if (new Set(requestedDivisions.map((division) => division.name)).size !== requestedDivisions.length) {
    throw apiError("같은 종별명을 두 번 사용할 수 없습니다.");
  }
  const requestedExistingIds = requestedDivisions.flatMap((division) => division.id ? [division.id] : []);
  if (new Set(requestedExistingIds).size !== requestedExistingIds.length) {
    throw apiError("종별 정보를 다시 확인해 주세요.");
  }

  const [existingDivisionsResult, sportNameConflict] = await Promise.all([
    env.DB.prepare(
      "SELECT id, sport_id AS sportId, name, school_level AS schoolLevel, display_order AS displayOrder, active FROM divisions WHERE sport_id = ? ORDER BY display_order, name",
    ).bind(sportId).all<DivisionRow>(),
    env.DB.prepare("SELECT id FROM sports WHERE tournament_id = ? AND name = ? AND id <> ?")
      .bind(sport.tournamentId, name, sportId).first<{ id: string }>(),
  ]);
  if (sportNameConflict) throw apiError("같은 대회에 동일한 종목명이 이미 있습니다.", 409, "DUPLICATE_SPORT");

  const existingDivisions = existingDivisionsResult.results;
  const existingById = new Map(existingDivisions.map((division) => [division.id, division]));
  const normalizedDivisions = requestedDivisions.map((division) => ({
    ...division, schoolLevel: divisionSchoolLevel(division.schoolLevel, tournament, division.id ? existingById.get(division.id) : undefined),
  }));
  for (const division of normalizedDivisions) {
    if (division.id && !existingById.has(division.id)) {
      throw apiError("다른 종목의 종별은 수정할 수 없습니다.", 400, "INVALID_DIVISION");
    }
  }
  const requestedIdSet = new Set(requestedExistingIds);
  for (const division of normalizedDivisions) {
    const nameOwner = existingDivisions.find((existing) => existing.name === division.name && existing.id !== division.id);
    if (nameOwner && !requestedIdSet.has(nameOwner.id)) {
      throw apiError(`'${division.name}' 종별이 이미 등록되어 있습니다.`, 409, "DUPLICATE_DIVISION");
    }
  }

  const existingIds = existingDivisions.map((division) => division.id);
  const usageRows = existingIds.length
    ? await env.DB.prepare(
      `SELECT division_id AS divisionId, COUNT(*) AS responseCount
       FROM response_items WHERE division_id IN (${existingIds.map(() => "?").join(",")})
       GROUP BY division_id`,
    ).bind(...existingIds).all<{ divisionId: string; responseCount: number }>()
    : { results: [] as Array<{ divisionId: string; responseCount: number }> };
  const usageByDivision = new Map(usageRows.results.map((row) => [row.divisionId, Number(row.responseCount)]));
  for (const division of normalizedDivisions) {
    if (division.id && existingById.get(division.id)?.schoolLevel !== division.schoolLevel && (usageByDivision.get(division.id) ?? 0) > 0) {
      throw apiError("저장된 신청이 있는 종별의 학교급은 변경할 수 없습니다. 새 종별을 추가해 주세요.", 409, "DIVISION_SCHOOL_LEVEL_IN_USE");
    }
  }
  const removedDivisions = existingDivisions.filter((division) => !requestedIdSet.has(division.id));
  const usedRemovedDivisions = removedDivisions.filter((division) => (usageByDivision.get(division.id) ?? 0) > 0);
  if (usedRemovedDivisions.length) {
    throw apiError(
      `${usedRemovedDivisions.map((division) => division.name).join(", ")} 종별에는 저장된 신청 내역이 있어 삭제할 수 없습니다. 이름은 수정할 수 있습니다.`,
      409,
      "DIVISION_IN_USE",
    );
  }

  if (existingIds.length) {
    const placeholders = existingIds.map(() => "?").join(",");
    const [maximumTotal, maximumItem] = await Promise.all([
      env.DB.prepare(
        `SELECT COALESCE(MAX(total), 0) AS value FROM (
           SELECT school_id, SUM(team_count) AS total
           FROM response_items WHERE division_id IN (${placeholders}) GROUP BY school_id
         )`,
      ).bind(...existingIds).first<{ value: number }>(),
      env.DB.prepare(
        `SELECT COALESCE(MAX(team_count), 0) AS value
         FROM response_items WHERE division_id IN (${placeholders})`,
      ).bind(...existingIds).first<{ value: number }>(),
    ]);
    if (Number(maximumTotal?.value ?? 0) > maxTeamsPerSchool) {
      throw apiError(
        `기존 신청 중 학교당 ${maximumTotal?.value}팀인 내역이 있어 최대 팀 수를 ${maxTeamsPerSchool}팀으로 줄일 수 없습니다.`,
        409,
        "MAX_TEAMS_IN_USE",
      );
    }
    if (
      maxTeamsPerDivision < Number(sport.maxTeamsPerDivision)
      && Number(maximumItem?.value ?? 0) > maxTeamsPerDivision
    ) {
      throw apiError(
        `기존 신청 중 한 종별에 ${maximumItem?.value}팀인 내역이 있어 한 종별 최대 팀 수를 ${maxTeamsPerDivision}팀으로 줄일 수 없습니다.`,
        409,
        "MAX_TEAMS_PER_DIVISION_IN_USE",
      );
    }
  }

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE sports SET name = ?, team_count_enabled = ?, max_teams_per_school = ?, max_teams_per_division = ?,
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(name, teamCountEnabled ? 1 : 0, maxTeamsPerSchool, maxTeamsPerDivision, sportId),
  ];
  normalizedDivisions.forEach((division, index) => {
    if (division.id) {
      statements.push(env.DB.prepare("UPDATE divisions SET name = ? WHERE id = ?")
        .bind(`__editing__${sportId}_${index}_${crypto.randomUUID()}`, division.id));
    }
  });
  removedDivisions.forEach((division) => {
    statements.push(env.DB.prepare("DELETE FROM divisions WHERE id = ?").bind(division.id));
  });
  normalizedDivisions.forEach((division, index) => {
    if (division.id) {
      statements.push(env.DB.prepare(
        "UPDATE divisions SET name = ?, school_level = ?, display_order = ?, active = 1 WHERE id = ?",
      ).bind(division.name, division.schoolLevel, index + 1, division.id));
    } else {
      statements.push(env.DB.prepare(
        "INSERT INTO divisions (id, sport_id, name, school_level, display_order, active) VALUES (?, ?, ?, ?, ?, 1)",
      ).bind(crypto.randomUUID(), sportId, division.name, division.schoolLevel, index + 1));
    }
  });
  statements.push(auditStatement(env.DB, "UPDATE", "sport", sportId, {
    before: {
      name: sport.name,
      teamCountEnabled: Boolean(sport.teamCountEnabled),
      maxTeamsPerSchool: Number(sport.maxTeamsPerSchool),
      maxTeamsPerDivision: Number(sport.maxTeamsPerDivision),
      divisions: existingDivisions.map((division) => ({ id: division.id, name: division.name, schoolLevel: division.schoolLevel })),
    },
    after: { name, teamCountEnabled, maxTeamsPerSchool, maxTeamsPerDivision, divisions: normalizedDivisions },
  }));
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/DIVISION_SCHOOL_LEVEL_IN_USE/iu.test(message)) {
      throw apiError("방금 저장된 신청이 있어 종별의 학교급을 변경할 수 없습니다. 새로고침 후 다시 확인해 주세요.", 409, "DIVISION_SCHOOL_LEVEL_IN_USE");
    }
    if (/MAX_TEAMS_PER_DIVISION_IN_USE/iu.test(message)) {
      throw apiError("방금 저장된 신청 내역과 한 종별 최대 팀 수가 충돌합니다. 새로고침 후 다시 확인해 주세요.", 409, "MAX_TEAMS_PER_DIVISION_IN_USE");
    }
    if (/MAX_TEAMS_IN_USE/iu.test(message)) {
      throw apiError("방금 저장된 신청 내역과 학교 전체 최대 팀 수가 충돌합니다. 새로고침 후 다시 확인해 주세요.", 409, "MAX_TEAMS_IN_USE");
    }
    if (/INVALID_TEAM_LIMIT_CONFIGURATION/iu.test(message)) {
      throw apiError("팀 수 한도 설정을 다시 확인해 주세요.", 400, "INVALID_TEAM_LIMIT_CONFIGURATION");
    }
    if (/FOREIGN KEY constraint failed/iu.test(message)) {
      throw apiError("방금 저장된 신청 내역이 있어 종별을 삭제할 수 없습니다. 새로고침 후 다시 확인해 주세요.", 409, "DIVISION_IN_USE");
    }
    throw error;
  }
  return json({ ok: true });
}

async function deleteSport(request: Request, env: Env, sportId: string): Promise<Response> {
  await requireSession(request, env.DB, "admin");
  const sport = await env.DB.prepare(
    "SELECT id, name, tournament_id AS tournamentId FROM sports WHERE id = ?",
  ).bind(sportId).first<{ id: string; name: string; tournamentId: string }>();
  if (!sport) throw apiError("종목을 찾을 수 없습니다.", 404, "NOT_FOUND");
  const usage = await env.DB.prepare(
    `SELECT COUNT(*) AS value FROM response_items ri
     JOIN divisions d ON d.id = ri.division_id WHERE d.sport_id = ?`,
  ).bind(sportId).first<{ value: number }>();
  if (Number(usage?.value ?? 0) > 0) {
    throw apiError(
      "이미 저장된 신청 내역이 있는 종목은 삭제할 수 없습니다. 결과 보존을 위해 신청 종료 후 비활성화를 사용해 주세요.",
      409,
      "SPORT_IN_USE",
    );
  }
  try {
    await env.DB.batch([
      auditStatement(env.DB, "DELETE", "sport", sportId, { tournamentId: sport.tournamentId, name: sport.name }),
      env.DB.prepare("DELETE FROM sports WHERE id = ?").bind(sportId),
    ]);
  } catch (error) {
    if (error instanceof Error && /FOREIGN KEY constraint failed/iu.test(error.message)) {
      throw apiError("방금 저장된 신청 내역이 있어 이 종목을 삭제할 수 없습니다.", 409, "SPORT_IN_USE");
    }
    throw error;
  }
  return json({ ok: true });
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.DB) throw apiError("데이터베이스 연결이 필요합니다.", 503, "DB_MISSING");
    assertSameOrigin(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    const path = new URL(request.url).pathname.replace(/^\/api\/?/u, "");

    if (request.method === "GET" && path === "bootstrap") return json(await publicBootstrap(request, env.DB));
    if (request.method === "POST" && path === "school/login") return await schoolLogin(request, env);
    if (request.method === "GET" && path === "school/session") return await schoolSession(request, env);
    if (request.method === "GET" && path === "school/participants") return await schoolParticipants(request, env);
    if (request.method === "PUT" && path === "school/survey") return await saveSurvey(request, env);
    if (request.method === "POST" && path === "school/logout") return await logout(request, env, "school");
    if (request.method === "POST" && path === "admin/login") return await adminLogin(request, env);
    if (request.method === "POST" && path === "admin/logout") return await logout(request, env, "admin");
    if (request.method === "GET" && path === "admin/dashboard") return await adminDashboard(request, env);
    if (request.method === "GET" && path === "admin/schools") return await adminSchools(request, env);
    if (request.method === "POST" && path === "admin/schools") return await addSchool(request, env);
    if (request.method === "PATCH" && path === "admin/credentials") return await updateAdminCredentials(request, env);
    if (request.method === "POST" && path === "admin/events") return await createEvent(request, env);
    if (request.method === "POST" && path === "admin/sports") return await addSport(request, env);

    const schoolCodeUpdate = path.match(/^admin\/schools\/([^/]+)\/institution-code$/u);
    if (schoolCodeUpdate && request.method === "PATCH") return await updateSchoolInstitutionCode(request, env, decodeURIComponent(schoolCodeUpdate[1]));
    const eventUpdate = path.match(/^admin\/events\/([^/]+)$/u);
    if (eventUpdate && request.method === "PATCH") return await updateEvent(request, env, decodeURIComponent(eventUpdate[1]));
    const eventCardUpdate = path.match(/^admin\/events\/([^/]+)\/card-copy$/u);
    if (eventCardUpdate && request.method === "PATCH") return await updateEventCard(request, env, decodeURIComponent(eventCardUpdate[1]));
    const pageHeaderUpdate = path.match(/^admin\/events\/([^/]+)\/header-copy$/u);
    if (pageHeaderUpdate && request.method === "PATCH") return await updatePageHeader(request, env, decodeURIComponent(pageHeaderUpdate[1]));
    const logoUpdate = path.match(/^admin\/events\/([^/]+)\/logo$/u);
    if (logoUpdate && ["PUT", "DELETE"].includes(request.method)) return await updateLogoImage(request, env, decodeURIComponent(logoUpdate[1]));
    const logoRead = path.match(/^events\/([^/]+)\/logo\/([a-f0-9-]{36})$/u);
    if (logoRead && request.method === "GET") return await getLogoImage(request, env, decodeURIComponent(logoRead[1]), logoRead[2]);
    const eventActivate = path.match(/^admin\/events\/([^/]+)\/activate$/u);
    if (eventActivate && request.method === "POST") return await activateEvent(request, env, decodeURIComponent(eventActivate[1]));
    const eventUnpublish = path.match(/^admin\/events\/([^/]+)\/unpublish$/u);
    if (eventUnpublish && request.method === "POST") return await unpublishEvent(request, env, decodeURIComponent(eventUnpublish[1]));
    const sportToggle = path.match(/^admin\/sports\/([^/]+)\/active$/u);
    if (sportToggle && request.method === "PATCH") return await toggleSport(request, env, decodeURIComponent(sportToggle[1]));
    const sportUpdate = path.match(/^admin\/sports\/([^/]+)$/u);
    if (sportUpdate && request.method === "PATCH") return await updateSport(request, env, decodeURIComponent(sportUpdate[1]));
    if (sportUpdate && request.method === "DELETE") return await deleteSport(request, env, decodeURIComponent(sportUpdate[1]));

    throw apiError("요청한 API를 찾을 수 없습니다.", 404, "NOT_FOUND");
  } catch (error) {
    const api = error as ApiError;
    return json(
      { error: api.message || "처리 중 문제가 발생했습니다.", code: api.code ?? "INTERNAL_ERROR" },
      api.status ?? 500,
    );
  }
}
