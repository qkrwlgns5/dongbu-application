"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { SCHOOL_LEVELS, schoolLevelLabel } from "./school-levels.js";

type SchoolLevel = "elementary" | "middle";
export type RegisteredSchool = {
  id: string;
  name: string;
  schoolLevel: SchoolLevel;
  displayOrder: number;
  active?: boolean;
};

type SchoolRegistration = { name: string; schoolLevel: SchoolLevel; institutionCode: string };
type AdminSchoolManagementProps = { onAdded?: () => Promise<void> };
export type InstitutionCodeChange = { ok: true; school: RegisteredSchool; sessionsRevoked: number; changed?: boolean };

export class SchoolRegistryError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SchoolRegistryError";
    this.status = status;
  }
}

export async function requestSchoolRegistry<T>(registration?: SchoolRegistration, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/admin/schools", {
      method: registration ? "POST" : "GET",
      credentials: "same-origin",
      signal,
      ...(registration ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(registration) } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new SchoolRegistryError(registration
      ? "연결이 끊겨 등록 결과를 확인하지 못했습니다. 목록을 새로고침하여 등록 여부를 확인해 주세요."
      : "학교 목록에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 불러와 주세요.", 0);
  }
  let result: { error?: unknown } & T;
  try { result = await response.json(); } catch {
    throw new SchoolRegistryError("서버 응답을 확인하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.", response.status);
  }
  if (!result || typeof result !== "object") throw new SchoolRegistryError("학교 정보 형식을 확인하지 못했습니다. 목록을 다시 불러와 주세요.", response.status);
  if (!response.ok) {
    throw new SchoolRegistryError(response.status === 401
      ? "관리자 로그인이 만료되었습니다. 다시 로그인해 주세요."
      : typeof result.error === "string" ? result.error : "학교 정보를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", response.status);
  }
  return result;
}

export function normalizeInstitutionCodeConfirmation(value: string) {
  const prefixes: Record<string, string> = { ehdsk: "동나", ehdsj: "동너", ehdek: "동다", ehdej: "동더" };
  return value.normalize("NFC").trim().replace(/^(ehdsk|ehdsj|ehdek|ehdej)(\d{2,4})$/i, (_, prefix: string, digits: string) => `${prefixes[prefix.toLowerCase()]}${digits}`);
}

export async function changeSchoolInstitutionCode(schoolId: string, institutionCode: string): Promise<InstitutionCodeChange> {
  const uncertain = "변경 결과를 확인하지 못했습니다. 자동으로 재시도하지 않았습니다. 새 기관번호로 학교 로그인이 되는지 확인한 뒤 필요하면 같은 번호를 다시 저장해 주세요.";
  let response: Response;
  try {
    response = await fetch(`/api/admin/schools/${encodeURIComponent(schoolId)}/institution-code`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ institutionCode }),
    });
  } catch { throw new SchoolRegistryError(uncertain, 0); }
  let result: InstitutionCodeChange & { error?: unknown };
  try { result = await response.json(); } catch { throw new SchoolRegistryError(uncertain, response.status); }
  if (!response.ok) {
    throw new SchoolRegistryError(response.status === 401
      ? "관리자 로그인이 만료되었습니다. 다시 로그인해 주세요."
      : typeof result?.error === "string" ? result.error : response.status === 404
        ? "수정할 학교를 찾을 수 없습니다. 목록을 새로고침해 주세요."
        : "기관번호를 변경하지 못했습니다. 학교급과 기관번호를 확인한 뒤 다시 시도해 주세요.", response.status);
  }
  if (!result || result.ok !== true || result.school?.id !== schoolId || typeof result.school?.name !== "string" || !Number.isInteger(result.sessionsRevoked) || result.sessionsRevoked < 0) {
    throw new SchoolRegistryError(uncertain, response.status);
  }
  return result;
}

function registrySchools(result: { schools: RegisteredSchool[] }) {
  if (!Array.isArray(result.schools) || result.schools.some((school) => !school || typeof school.id !== "string" || typeof school.name !== "string" || !["elementary", "middle"].includes(school.schoolLevel) || !Number.isFinite(school.displayOrder))) {
    throw new SchoolRegistryError("학교 목록 형식을 확인하지 못했습니다. 다시 불러와 주세요.", 200);
  }
  return result.schools;
}

function orderSchools(schools: RegisteredSchool[]) {
  return [...schools].sort((a, b) => Number(a.schoolLevel === "middle") - Number(b.schoolLevel === "middle") || a.displayOrder - b.displayOrder || a.name.localeCompare(b.name, "ko"));
}

export function SchoolRegistryList({ schools, onEditInstitutionCode, editingSchoolId, busy = false }: { schools: RegisteredSchool[]; onEditInstitutionCode?: (school: RegisteredSchool) => void; editingSchoolId?: string; busy?: boolean }) {
  if (!schools.length) return <p className="school-registry-empty">조건에 맞는 학교가 없습니다.</p>;
  return <ul className="school-registry-list" aria-label="등록 학교 목록">{orderSchools(schools).map((school) => <li key={school.id}>
    <span className="school-registry-order" aria-label={`${schoolLevelLabel(school.schoolLevel)} 순번 ${school.displayOrder}`}>{school.displayOrder}</span>
    <div className="school-registry-name"><b>{school.name}</b><small>{schoolLevelLabel(school.schoolLevel)}{school.active === false ? " · 비활성" : ""}</small></div>
    <div className="school-registry-actions"><span className={`school-registry-badge${school.active === false ? " inactive" : ""}`}>{school.active === false ? "비활성" : "등록 완료"}</span>{onEditInstitutionCode && <button type="button" className="school-registry-edit-button" aria-label={`${school.name} 기관번호 수정`} aria-expanded={editingSchoolId === school.id} aria-controls={editingSchoolId === school.id ? "school-institution-code-editor" : undefined} disabled={busy} onClick={() => onEditInstitutionCode(school)}>기관번호 수정</button>}</div>
  </li>)}</ul>;
}

export function InstitutionCodeEditor({ school, disabled = false, onBusyChange, onSaved, onCancel, onAuthenticationExpired }: {
  school: RegisteredSchool;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
  onSaved: (result: InstitutionCodeChange) => Promise<void>;
  onCancel: () => void;
  onAuthenticationExpired: () => void;
}) {
  const [nextCode, setNextCode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const requestInFlight = useRef(false);
  const mounted = useRef(false);
  const blocked = disabled || busy;
  const expectedPrefix = school.schoolLevel === "elementary" ? "동나 또는 동너" : "동다 또는 동더";

  useEffect(() => {
    mounted.current = true;
    const form = formRef.current;
    const frame = window.requestAnimationFrame(() => {
      form?.scrollIntoView({ block: "nearest", behavior: "auto" });
      form?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    });
    return () => {
      mounted.current = false;
      window.cancelAnimationFrame(frame);
      // The keyed editor is discarded when choosing another school or leaving
      // this view. Clear the detached inputs as well; codes are never persisted.
      form?.querySelectorAll<HTMLInputElement>("input").forEach((input) => { input.value = ""; });
    };
  }, []);

  function clearDrafts() { setNextCode(""); setConfirmation(""); setShowCode(false); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || requestInFlight.current) return;
    const normalized = normalizeInstitutionCodeConfirmation(nextCode);
    if (!normalized || !confirmation.trim()) { setError("새 기관번호와 확인 기관번호를 모두 입력해 주세요."); return; }
    if (normalized !== normalizeInstitutionCodeConfirmation(confirmation)) { setError("두 기관번호가 일치하지 않습니다. 확인란을 다시 입력해 주세요."); return; }
    requestInFlight.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      const result = await changeSchoolInstitutionCode(school.id, normalized);
      if (!mounted.current) return;
      clearDrafts();
      await onSaved(result);
    } catch (requestError) {
      if (mounted.current) {
        setError(requestError instanceof Error ? requestError.message : "기관번호를 변경하지 못했습니다.");
        if (requestError instanceof SchoolRegistryError && requestError.status === 401) { clearDrafts(); onAuthenticationExpired(); }
      }
    } finally {
      requestInFlight.current = false;
      onBusyChange(false);
      if (mounted.current) setBusy(false);
    }
  }

  return <section className="school-institution-editor" id="school-institution-code-editor" aria-labelledby="school-institution-editor-title">
    <header><p>학교 로그인 정보 변경</p><h3 id="school-institution-editor-title">기관번호 수정</h3><div className="school-institution-target"><b>{school.name}</b><span>{schoolLevelLabel(school.schoolLevel)}</span></div></header>
    <p className="school-institution-warning">변경하면 이 학교는 모든 대회에서 새 기관번호로 로그인해야 합니다. 이전 기관번호는 사용할 수 없고, 이 학교의 기존 로그인은 종료됩니다. 저장된 신청과 학교 정보는 그대로 유지됩니다.</p>
    <form ref={formRef} onSubmit={(event) => void submit(event)} aria-busy={busy}>
      <label htmlFor="registry-new-institution-code"><span>새 기관번호</span><input id="registry-new-institution-code" value={nextCode} type={showCode ? "text" : "password"} onChange={(event) => setNextCode(event.target.value)} autoComplete="new-password" autoCapitalize="none" spellCheck={false} maxLength={32} placeholder="새 기관번호 입력" required disabled={blocked} aria-describedby="registry-new-code-help" /></label>
      <label htmlFor="registry-confirm-institution-code"><span>새 기관번호 확인</span><input id="registry-confirm-institution-code" value={confirmation} type={showCode ? "text" : "password"} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" autoCapitalize="none" spellCheck={false} maxLength={32} placeholder="새 기관번호 다시 입력" required disabled={blocked} aria-describedby="registry-new-code-help" /></label>
      <button type="button" className="school-institution-visibility" aria-label={showCode ? "새 기관번호 숨기기" : "새 기관번호 표시"} aria-pressed={showCode} disabled={blocked} onClick={() => setShowCode((current) => !current)}>{showCode ? "입력한 기관번호 숨기기" : "입력한 기관번호 보기"}</button>
      <p className="school-registry-hint" id="registry-new-code-help">{expectedPrefix} 뒤에 숫자 2~4자리를 입력해 주세요. 한글과 영문 키보드로 입력한 같은 번호는 동일하게 확인합니다. 현재 기관번호는 조회하거나 미리 채우지 않습니다.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" className="outline-button" disabled={blocked} onClick={() => { if (requestInFlight.current) return; clearDrafts(); setError(""); onCancel(); }}>취소</button><button type="submit" className="solid-button" disabled={blocked}>{busy ? "기관번호 변경 중…" : "기관번호 변경 저장"}</button></footer>
    </form>
  </section>;
}

export default function AdminSchoolManagement({ onAdded }: AdminSchoolManagementProps) {
  const [schools, setSchools] = useState<RegisteredSchool[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [levelFilter, setLevelFilter] = useState<"all" | SchoolLevel>("all");
  const [query, setQuery] = useState("");
  const [schoolLevel, setSchoolLevel] = useState<SchoolLevel>("elementary");
  const [name, setName] = useState("");
  const [institutionCode, setInstitutionCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loginExpired, setLoginExpired] = useState(false);
  const [editingSchool, setEditingSchool] = useState<RegisteredSchool | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeNotice, setCodeNotice] = useState("");
  const requestInFlight = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    requestSchoolRegistry<{ schools: RegisteredSchool[] }>(undefined, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setSchools(registrySchools(result)); })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(requestError instanceof Error ? requestError.message : "학교 목록을 불러오지 못했습니다.");
        setLoginExpired(requestError instanceof SchoolRegistryError && requestError.status === 401);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { mounted.current = false; controller.abort(); };
  }, []);

  async function refreshSchools() {
    setLoading(true);
    setLoadError("");
    try {
      const result = await requestSchoolRegistry<{ schools: RegisteredSchool[] }>();
      if (mounted.current) { setSchools(registrySchools(result)); setLoginExpired(false); }
    } catch (requestError) {
      if (mounted.current) {
        setLoadError(requestError instanceof Error ? requestError.message : "학교 목록을 불러오지 못했습니다.");
        setLoginExpired(requestError instanceof SchoolRegistryError && requestError.status === 401);
      }
    } finally { if (mounted.current) setLoading(false); }
  }

  async function registerSchool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlight.current) return;
    const cleanName = name.normalize("NFC").trim();
    const cleanCode = institutionCode.normalize("NFC").trim();
    if (!cleanName || !cleanCode) { setError("학교 이름과 기관번호를 모두 입력해 주세요."); return; }
    requestInFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await requestSchoolRegistry<{ school: RegisteredSchool }>({ name: cleanName, schoolLevel, institutionCode: cleanCode });
      if (!mounted.current) return;
      const registeredSchool = registrySchools({ schools: [result.school] })[0];
      setInstitutionCode("");
      setShowCode(false);
      setName("");
      setSchools((current) => orderSchools([...current.filter((school) => school.id !== registeredSchool.id), registeredSchool]));
      setNotice(`${registeredSchool.name}를 등록했습니다. 기관번호는 안전하게 저장되며 목록에는 표시되지 않습니다.`);
      await refreshSchools();
      if (onAdded) {
        try { await onAdded(); } catch {
          if (mounted.current) setNotice(`${registeredSchool.name} 등록은 완료되었습니다. 다른 관리자 화면의 현황은 새로고침하면 갱신됩니다.`);
        }
      }
    } catch (requestError) {
      if (mounted.current) {
        setError(requestError instanceof Error ? requestError.message : "학교를 등록하지 못했습니다.");
        setLoginExpired(requestError instanceof SchoolRegistryError && requestError.status === 401);
      }
    } finally {
      requestInFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function selectSchoolForCodeChange(school: RegisteredSchool) {
    if (requestInFlight.current || loginExpired) return;
    setCodeNotice("");
    setEditingSchool(school);
  }

  async function institutionCodeSaved(result: InstitutionCodeChange) {
    if (!mounted.current) return;
    setCodeNotice(result.changed === false
      ? `${result.school.name}: 기존 기관번호와 같아 변경하지 않았습니다. 저장된 신청은 그대로 유지됩니다.`
      : `${result.school.name}의 기관번호를 변경했습니다. 이전 번호로는 로그인할 수 없으며 저장된 신청은 유지됩니다. 기존 로그인 ${result.sessionsRevoked}건을 종료했습니다.`);
    setEditingSchool(null);
    await refreshSchools();
  }

  const filteredSchools = schools.filter((school) => (levelFilter === "all" || school.schoolLevel === levelFilter) && school.name.normalize("NFC").includes(query.normalize("NFC").trim()));
  const expectedPrefix = schoolLevel === "elementary" ? "동나 또는 동너" : "동다 또는 동더";
  return <section className="admin-school-management" aria-labelledby="school-management-title">
    <article className="settings-card school-registration-card">
      <header><span aria-hidden="true">01</span><div><p>ADD SCHOOL</p><h2 id="school-management-title">새 학교 등록</h2></div></header>
      <p className="school-registry-description">새로 등록한 학교는 해당 학교급을 대상으로 하는 현재·향후 대회에 참여할 수 있습니다. 이미 종료된 대회의 대상 학교 수와 기존 신청은 그대로 보존됩니다.</p>
      <form onSubmit={(event) => void registerSchool(event)} aria-busy={busy}>
        <label htmlFor="registry-school-level"><span>학교급</span><select id="registry-school-level" value={schoolLevel} onChange={(event) => setSchoolLevel(event.target.value as SchoolLevel)} disabled={busy || codeBusy}>{SCHOOL_LEVELS.map((level) => <option value={level.value} key={level.value}>{level.label}</option>)}</select></label>
        <label htmlFor="registry-school-name"><span>학교 이름</span><input id="registry-school-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={schoolLevel === "elementary" ? "예: 인천○○초등학교" : "예: 인천○○중학교"} maxLength={100} autoComplete="off" required disabled={busy || codeBusy} /><small>학교의 정식 이름을 입력해 주세요. 같은 이름의 학교는 중복 등록할 수 없습니다.</small></label>
        <label htmlFor="registry-institution-code"><span>기관번호 <small>학교 로그인 비밀번호</small></span><span className="registry-code-field"><input id="registry-institution-code" value={institutionCode} onChange={(event) => setInstitutionCode(event.target.value)} type={showCode ? "text" : "password"} placeholder="기관번호 입력" autoComplete="new-password" autoCapitalize="none" spellCheck={false} maxLength={32} required disabled={busy || codeBusy} aria-describedby="registry-code-help" /><button type="button" aria-label={showCode ? "기관번호 숨기기" : "기관번호 표시"} aria-pressed={showCode} disabled={busy || codeBusy} onClick={() => setShowCode((value) => !value)}>{showCode ? "숨김" : "보기"}</button></span></label>
        <p className="school-registry-hint" id="registry-code-help">{expectedPrefix} 뒤에 숫자 2~4자리를 입력해 주세요. 한글 기관번호와 영문 키보드 입력을 모두 사용할 수 있습니다.</p>
        <p className="school-registry-hint">학교 순번은 해당 학교급 목록의 마지막 번호 다음으로 자동 배정됩니다. 기존 학교의 기관번호는 등록 학교 목록의 ‘기관번호 수정’ 버튼에서 변경할 수 있습니다.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="school-registry-notice" role="status" aria-live="polite">{notice}</p>}
        {loginExpired && <a className="school-registry-login" href="/admin">관리자 로그인으로 이동 →</a>}
        <button className="solid-button" disabled={busy || codeBusy || loginExpired}>{busy ? "학교 등록 중…" : "+ 학교 등록"}</button>
      </form>
    </article>
    <article className="settings-card school-registry-card" aria-labelledby="school-registry-title">
      <header><span aria-hidden="true">02</span><div><p>SCHOOL REGISTRY</p><h2 id="school-registry-title">등록 학교 <small>{loading && !schools.length ? "확인 중" : `${schools.length}개교`}</small></h2></div></header>
      <div className="school-registry-toolbar"><div className="school-registry-tabs" role="group" aria-label="등록 학교급 필터"><button type="button" aria-pressed={levelFilter === "all"} onClick={() => setLevelFilter("all")}>전체 <b>{schools.length}</b></button>{SCHOOL_LEVELS.map((level) => <button type="button" key={level.value} aria-pressed={levelFilter === level.value} onClick={() => setLevelFilter(level.value as SchoolLevel)}>{level.label} <b>{schools.filter((school) => school.schoolLevel === level.value).length}</b></button>)}</div><label className="school-registry-search"><span className="sr-only">등록 학교 이름 검색</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="학교 이름 검색" /></label></div>
      <div className="school-registry-list-heading"><span aria-live="polite">{query.trim() ? `검색 결과 ${filteredSchools.length}개교` : "학교급별 등록 순서"}</span><button type="button" disabled={loading || busy || codeBusy} onClick={() => void refreshSchools()}>{loading ? "불러오는 중…" : "목록 새로고침"}</button></div>
      {loadError && <div className="school-registry-load-error" role="alert"><p>{loadError}</p><button type="button" className="outline-button" disabled={loading || busy || codeBusy} onClick={() => void refreshSchools()}>다시 불러오기</button></div>}
      {codeNotice && <p className="school-registry-notice school-code-change-notice" role="status" aria-live="polite">{codeNotice}</p>}
      {editingSchool && <InstitutionCodeEditor key={editingSchool.id} school={editingSchool} disabled={busy || loginExpired} onBusyChange={(value) => { requestInFlight.current = value; if (mounted.current) setCodeBusy(value); }} onSaved={institutionCodeSaved} onCancel={() => setEditingSchool(null)} onAuthenticationExpired={() => setLoginExpired(true)} />}
      {loginExpired && editingSchool && <a className="school-registry-login" href="/admin">관리자 로그인으로 이동 →</a>}
      <div className="school-registry-scroll" aria-busy={loading}>{loading && !schools.length ? <p className="school-registry-empty" role="status">학교 목록을 불러오고 있습니다.</p> : <SchoolRegistryList schools={filteredSchools} onEditInstitutionCode={selectSchoolForCodeChange} editingSchoolId={editingSchool?.id} busy={busy || codeBusy || loginExpired} />}</div>
      <p className="school-registry-hint school-registry-security">학교 로그인 기관번호는 이 목록에 표시되지 않습니다.</p>
    </article>
  </section>;
}
