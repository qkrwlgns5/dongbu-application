"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- vinext internal links need a full document navigation in this deployment. */

import { FormEvent, Fragment, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { EVENT_CARD_FIELDS, eventCardCopy, formatEventCardDate } from "./event-card-copy.js";
import { PAGE_HEADER_FIELDS, pageHeaderCopy } from "./page-header-copy.js";
import { SCHOOL_LEVELS, schoolLevels, schoolLevelLabel, schoolLevelsLabel } from "./school-levels.js";
import { SPORT_ICONS, resolveSportIcon } from "./sport-icons.js";
import { cleanCanvasPngBytes } from "./logo-png.js";
import AdminSchoolManagement from "./admin-school-management";

type SchoolLevel = "elementary" | "middle";

type Tournament = {
  id: string;
  academicYear: number;
  name: string;
  surveyStart: string;
  cardCopy: string;
  headerCopy: string;
  logoKey?: string;
  schoolLevels?: string;
  surveyEnd: string;
  status: "draft" | "active" | "archived";
};

type Division = { id: string; name: string; displayOrder: number; active: boolean; schoolLevel?: SchoolLevel };
type Sport = {
  id: string;
  name: string;
  iconKey?: string;
  displayOrder: number;
  teamCountEnabled: boolean;
  maxTeamsPerSchool: number;
  maxTeamsPerDivision: number;
  active: boolean;
  divisions: Division[];
};

type School = { id: string; name: string; displayOrder: number; schoolLevel?: SchoolLevel };
type Survey = {
  submitted: boolean;
  noParticipation: boolean;
  revision: number;
  updatedAt: string | null;
  selections: Array<{ divisionId: string; teamCount: number }>;
};

type Bootstrap = {
  title: string;
  tournament: Tournament | null;
  surveyState: { open: boolean; code: string; message: string };
  schools: School[];
  sports: Sport[];
  tournaments?: Array<Tournament & { surveyState: { open: boolean; code: string; message: string } }>;
  defaultEventId?: string | null;
};

type SchoolSession = {
  school: Pick<School, "id" | "name" | "schoolLevel">;
  tournament: Tournament;
  sports: Sport[];
  survey: Survey;
};

type SportParticipants = {
  id: string;
  name: string;
  schoolCount: number;
  teamCount: number;
  divisions: Array<{ id: string; name: string; schoolCount: number; teamCount: number; schoolLevel?: SchoolLevel }>;
  schools: Array<{ schoolId: string; schoolName: string; schoolLevel?: SchoolLevel; isOwnSchool: boolean; teamCount: number; selections: Array<{ divisionId: string; divisionName: string; teamCount: number }> }>;
};
type ParticipantOverview = { tournamentId: string; queriedAt: string; sports: SportParticipants[] };

type ResultRow = {
  school: School;
  submitted: boolean;
  noParticipation: boolean;
  revision: number;
  updatedAt: string | null;
  selections: Array<{ divisionId: string; teamCount: number }>;
};

type Dashboard = {
  adminUsername: string;
  defaultEventId?: string | null;
  events: Tournament[];
  selectedEvent: Tournament | null;
  surveyState?: { open: boolean; code: string; message: string };
  sports: Sport[];
  rows: ResultRow[];
};

type SportUpdatePayload = {
  name: string;
  iconKey: string;
  divisions: Array<{ id?: string; name: string; schoolLevel: SchoolLevel }>;
  maxTeamsPerSchool: number;
  maxTeamsPerDivision: number;
};

type DivisionDraft = { key: string; id?: string; name: string; schoolLevel: SchoolLevel };

class ApiRequestError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: init?.body ? { "Content-Type": "application/json", ...(init.headers ?? {}) } : init?.headers,
  });
  let payload: { error?: string; code?: string } & Partial<T> = {};
  try { payload = await response.json() as { error?: string; code?: string } & Partial<T>; } catch { payload = {}; }
  if (!response.ok) throw new ApiRequestError(payload.error ?? "요청을 처리하지 못했습니다.", response.status, payload.code ?? "REQUEST_FAILED");
  return payload as T;
}

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatDate(value: string | null): string {
  if (!value) return "-";
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "-";
  return dateFormatter.format(date).replace(/\. /gu, ".").replace(". ", ". ");
}

function teamLimitLabel(sport: Pick<Sport, "maxTeamsPerSchool" | "maxTeamsPerDivision">): string {
  return `학교 전체 최대 ${sport.maxTeamsPerSchool}팀 · 한 종별 최대 ${sport.maxTeamsPerDivision}팀`;
}

function compactTeamLimitLabel(sport: Pick<Sport, "maxTeamsPerSchool" | "maxTeamsPerDivision">): string {
  return `전체 ${sport.maxTeamsPerSchool}팀 · 종별 ${sport.maxTeamsPerDivision}팀`;
}

function seoulInputValue(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function seoulInputToIso(value: string): string {
  return new Date(`${value}:00+09:00`).toISOString();
}

function splitSentences(value: string): string[] {
  const normalized = value.trim();
  if (!normalized) return [];
  if (typeof Intl.Segmenter === "function") {
    return Array.from(
      new Intl.Segmenter("ko", { granularity: "sentence" }).segment(normalized),
      ({ segment }) => segment.trim(),
    ).filter(Boolean);
  }
  return normalized.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/gu)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [normalized];
}

function SentenceFlow({ text }: { text: string }) {
  const sentences = splitSentences(text);
  return <>{sentences.map((sentence, index) => <Fragment key={`${index}-${sentence}`}>{index > 0 ? " " : null}<span className="sentence-unit">{sentence}</span></Fragment>)}</>;
}

function CardText({ text }: { text: string }) {
  return <>{text.split("\n").map((line, index) => <span className="card-copy-line" key={index}>{line ? <SentenceFlow text={line} /> : <br />}</span>)}</>;
}

function Brand({ admin = false, tournament, copy, preview = false, imageUrl }: { admin?: boolean; tournament?: Tournament | null; copy?: Record<string, string>; preview?: boolean; imageUrl?: string | null }) {
  const content = pageHeaderCopy(tournament, copy);
  const savedImage = tournament?.logoKey ? `/api/events/${encodeURIComponent(tournament.id)}/logo/${encodeURIComponent(tournament.logoKey)}` : "";
  const src = imageUrl === undefined ? savedImage : imageUrl;
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const Container = preview ? "div" : "a";
  return (
    <Container className="brand" href={preview ? undefined : admin ? "/admin" : "/"} aria-label={preview ? undefined : "참가 신청 처음으로"}>
      {/* A new source gets a new DOM image. Until it loads (or if it fails),
          keep its reserved space empty instead of showing the previous logo. */}
      {src
        ? <img key={src} className="brand-image" src={src} alt="" width={48} height={48} style={{ visibility: loadedSrc === src ? "visible" : "hidden" }} onLoad={() => setLoadedSrc(src)} onError={() => setLoadedSrc(null)} />
        : <span className="brand-mark" data-length={[...content.logoText.normalize("NFC")].length} aria-hidden="true">{content.logoText}</span>}
      <span><SentenceFlow text={content.brandName} />{content.brandSubtitle && <b><SentenceFlow text={content.brandSubtitle} /></b>}</span>
    </Container>
  );
}

function ApplicationIntro({ tournament, copy, preview = false }: { tournament: Tournament | null; copy?: Record<string, string>; preview?: boolean }) {
  const content = pageHeaderCopy(tournament, copy);
  const Heading = preview ? "h3" : "h1";
  return <div className="intro-copy">
    <div className="year-heading">{tournament && <span className="academic-year-badge">{tournament.academicYear}학년도</span>}{content.eyebrow && <p className="eyebrow">{content.eyebrow}</p>}</div>
    <Heading className="application-heading"><span className="intro-title-primary"><CardText text={content.titlePrimary} /></span>{content.titleSecondary && <span className="intro-title-secondary"><CardText text={content.titleSecondary} /></span>}</Heading>
  </div>;
}

function PageLoader({ message = "참가 신청 정보를 불러오고 있습니다." }: { message?: string }) {
  return <main className="center-state" role="status" aria-busy="true"><span className="loading-ring" aria-hidden="true" /><b><SentenceFlow text={message} /></b><small>잠시만 기다려 주세요.</small></main>;
}

function UiIcon({ name }: { name: "school" | "calendar" | "search" | "lock" | "arrow" | "check" }) {
  const paths = {
    school: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7M9 10h.01M15 10h.01",
    calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
    search: "m21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
    lock: "M6 11h12v10H6ZM8 11V7a4 4 0 0 1 8 0v4",
    arrow: "M4 12h16m-6-6 6 6-6 6",
    check: "m5 12 4 4L19 6",
  };
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function ApplicationSteps({ current }: { current: number }) {
  return <ol className="application-steps" aria-label="신청 단계">{["학교 선택", "참가 신청", "저장 완료"].map((label, index) => <li key={label} className={current === index + 1 ? "current" : current > index + 1 ? "complete" : ""} aria-current={current === index + 1 ? "step" : undefined}><i>{current > index + 1 ? "✓" : index + 1}</i>{label}</li>)}</ol>;
}

function EventCard({ tournament, sports, schoolCount, copy }: { tournament: Tournament | null; sports: Sport[]; schoolCount: number; copy?: Record<string, string> }) {
  const content = eventCardCopy(tournament, copy);
  return <aside className="event-card" aria-label="대회 참가 신청 안내">
    <div className="event-card-kicker">{content.eyebrow && <span>{content.eyebrow}</span>}{content.badge && <span>{content.badge}</span>}</div>
    <div className="event-card-titles">{content.title && <h2 data-long-title={content.title.split(/\s+/u).some((word: string) => Array.from(word).length >= 8)}><CardText text={content.title} /></h2>}{content.subtitle && <h3><CardText text={content.subtitle} /></h3>}{content.description && <p><CardText text={content.description} /></p>}</div>
    <div className="event-card-details">{tournament && <div><UiIcon name="calendar" /><span>신청 기간</span><b><span>{formatEventCardDate(tournament.surveyStart)}</span><span>~ {formatEventCardDate(tournament.surveyEnd)}</span></b></div>}{content.target && <div><UiIcon name="school" /><span>참가 대상</span><b><SentenceFlow text={content.target} /></b></div>}</div>
    <div className="event-card-sports">{sports.filter((sport) => sport.active).map((sport) => <span key={sport.id}>{sport.name}</span>)}</div>
    <div className="event-card-bottom">{content.footer && <span><UiIcon name="check" /><SentenceFlow text={content.footer} /></span>}<b>{schoolCount}<small>개교</small></b></div>
  </aside>;
}

function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return <main className="center-state error-state"><span>!</span><b>페이지를 열지 못했습니다.</b><small><SentenceFlow text={message} /></small><button onClick={retry}>다시 시도</button><a href="/">공개 대회 목록으로 돌아가기</a></main>;
}

export function SurveyApp({ initialView = "school" }: { initialView?: "school" | "admin" }) {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [schoolSession, setSchoolSession] = useState<SchoolSession | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [phase, setPhase] = useState<"loading" | "login" | "survey" | "admin-login" | "admin">("loading");
  const [fatalError, setFatalError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [switchingSurvey, setSwitchingSurvey] = useState(false);
  const [surveyChoiceError, setSurveyChoiceError] = useState("");
  const choiceSequence = useRef(0);

  // Bootstrap may refer to a different event than the authenticated session.
  // Do not publish any event's title until the destination view is resolved.
  const visibleTournament = phase === "admin" ? dashboard?.selectedEvent
    : phase === "survey" ? schoolSession?.tournament
      : phase === "login" || phase === "admin-login" ? bootstrap?.tournament : null;
  useEffect(() => {
    const neutralTitle = initialView === "admin" ? "관리자 · 참가 신청" : "참가 신청";
    if (!visibleTournament || fatalError) {
      document.title = neutralTitle;
      return;
    }
    const copy = pageHeaderCopy(visibleTournament);
    const title = [copy.titlePrimary, copy.titleSecondary].filter(Boolean).join(" ").replace(/\s+/gu, " ").trim();
    document.title = initialView === "admin" ? `관리자 · ${title}` : title;
  }, [visibleTournament, initialView, fatalError]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setFatalError("");
      setPhase("loading");
      try {
        const requestedId = initialView === "school" ? new URLSearchParams(window.location.search).get("tournamentId") : null;
        const boot = await api<Bootstrap>(`bootstrap${requestedId ? `?tournamentId=${encodeURIComponent(requestedId)}` : ""}`);
        if (!mounted) return;
        setBootstrap(boot);
        if (initialView === "admin") {
          try {
            const admin = await api<Dashboard>("admin/dashboard");
            if (!mounted) return;
            setDashboard(admin);
            setPhase("admin");
          } catch (error) {
            if (!mounted) return;
            if (error instanceof ApiRequestError && error.status === 401) setPhase("admin-login");
            else throw error;
          }
          return;
        }
        try {
          const session = await api<SchoolSession>(`school/session${requestedId ? `?tournamentId=${encodeURIComponent(requestedId)}` : ""}`);
          if (!mounted) return;
          setSchoolSession(session);
          setPhase("survey");
        } catch (error) {
          if (!mounted) return;
          if (error instanceof ApiRequestError && [401, 403, 409].includes(error.status)) setPhase("login");
          else throw error;
        }
      } catch (error) {
        if (!mounted) return;
        setFatalError(error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.");
      }
    }
    void load();
    return () => { mounted = false; };
  }, [initialView, reloadKey]);

  async function refreshDashboard(eventId?: string) {
    const query = eventId ? `?eventId=${encodeURIComponent(eventId)}` : "";
    const next = await api<Dashboard>(`admin/dashboard${query}`);
    setDashboard(next);
    const boot = await api<Bootstrap>("bootstrap");
    setBootstrap(boot);
  }

  async function chooseTournament(tournamentId: string) {
    const sequence = ++choiceSequence.current;
    setSwitchingSurvey(true);
    setSurveyChoiceError("");
    try {
      const next = await api<Bootstrap>(`bootstrap?tournamentId=${encodeURIComponent(tournamentId)}`);
      if (sequence !== choiceSequence.current) return;
      setBootstrap(next);
      setSchoolSession(null);
      window.history.replaceState(null, "", `/?tournamentId=${encodeURIComponent(tournamentId)}`);
    } catch (error) {
      if (sequence === choiceSequence.current) setSurveyChoiceError(error instanceof Error ? error.message : "대회를 불러오지 못했습니다.");
    } finally { if (sequence === choiceSequence.current) setSwitchingSurvey(false); }
  }

  if (fatalError) return <ErrorState message={fatalError} retry={() => setReloadKey((value) => value + 1)} />;
  if (phase === "loading" || !bootstrap) return <PageLoader />;
  if (phase === "login") return <SchoolLogin key={bootstrap.tournament?.id ?? "none"} bootstrap={bootstrap} switchingSurvey={switchingSurvey} choiceError={surveyChoiceError} onChooseTournament={chooseTournament} onLogin={(session) => { window.history.replaceState(null, "", `/?tournamentId=${encodeURIComponent(session.tournament.id)}`); setSchoolSession(session); setPhase("survey"); }} />;
  if (phase === "survey" && schoolSession) return <SurveyForm key={`${schoolSession.tournament.id}-${schoolSession.school.id}`} session={schoolSession} />;
  if (phase === "admin-login") return <AdminLogin tournament={bootstrap.tournament} onLogin={async () => { await refreshDashboard(); setPhase("admin"); }} />;
  if (phase === "admin" && dashboard) return <AdminPanel dashboard={dashboard} refresh={refreshDashboard} />;
  return <PageLoader />;
}

function SurveyPicker({ bootstrap, busy, error, onChoose }: { bootstrap: Bootstrap; busy: boolean; error?: string; onChoose?: (id: string) => Promise<void> }) {
  const choices = bootstrap.tournaments ?? [];
  if (choices.length < 2) return error ? <p className="form-error" role="alert">{error}</p> : null;
  return <section className="survey-picker" aria-labelledby="survey-picker-title" aria-busy={busy}>
    <div><p>SELECT EVENT</p><h2 id="survey-picker-title">참가신청할 대회를 선택해 주세요</h2><small>대회별로 신청이 따로 저장됩니다. 진행 중인 대회를 선택한 뒤 학교로 로그인해 주세요.</small></div>
    <label><span>대회 선택</span><select value={bootstrap.tournament?.id ?? ""} disabled={busy} onChange={(event) => void onChoose?.(event.target.value)}>{choices.map((item) => <option key={item.id} value={item.id}>{item.academicYear} · {item.name} · {item.surveyState.open ? "진행 중" : item.surveyState.code === "NOT_STARTED" ? "시작 전" : "종료"}</option>)}</select></label>
    {bootstrap.tournament && <div className="survey-picker-detail"><b>{schoolLevelsLabel(bootstrap.tournament.schoolLevels)}</b><span>{formatEventCardDate(bootstrap.tournament.surveyStart)} ~ {formatEventCardDate(bootstrap.tournament.surveyEnd)}</span></div>}
    {busy && <p role="status">선택한 대회를 불러오는 중입니다…</p>}{error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

function SchoolLogin({ bootstrap, onLogin, onChooseTournament, switchingSurvey = false, choiceError = "" }: { bootstrap: Bootstrap; onLogin: (session: SchoolSession) => void; onChooseTournament?: (id: string) => Promise<void>; switchingSurvey?: boolean; choiceError?: string }) {
  const [selectedSchool, setSelectedSchool] = useState("");
  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<"all" | SchoolLevel>("all");
  const eligibleLevels = schoolLevels(bootstrap.tournament?.schoolLevels);
  const mixedLevels = eligibleLevels.length > 1;
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setBusy] = useState(false);
  const busy = submitting || switchingSurvey;
  const [error, setError] = useState("");
  const filteredSchools = useMemo(
    () => bootstrap.schools.filter((school) => school.name.includes(query.trim()) && (levelFilter === "all" || (school.schoolLevel ?? "middle") === levelFilter)).sort((a, b) => Number((a.schoolLevel ?? "middle") === "middle") - Number((b.schoolLevel ?? "middle") === "middle") || a.displayOrder - b.displayOrder),
    [bootstrap.schools, query, levelFilter],
  );
  const selectedName = bootstrap.schools.find((school) => school.id === selectedSchool)?.name;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !selectedSchool || !password || !bootstrap.surveyState.open) return;
    setBusy(true);
    setError("");
    try {
      const session = await api<SchoolSession>("school/login", {
        method: "POST",
        body: JSON.stringify({ schoolId: selectedSchool, password, tournamentId: bootstrap.tournament?.id }),
      });
      onLogin(session);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "로그인하지 못했습니다.");
    } finally { setBusy(false); }
  }

  return (
    <main className="site-shell redesigned-login">
      <header className="brand-bar"><Brand tournament={bootstrap.tournament} /><div className="header-right"><span>학교별 온라인 참가 신청</span><a className="admin-link" href="/admin">관리자</a></div></header>
      <section className="login-stage" id="top">
        <div className="page-intro"><ApplicationIntro tournament={bootstrap.tournament} /><ApplicationSteps current={1} /></div>
        <SurveyPicker bootstrap={bootstrap} busy={busy} error={choiceError} onChoose={onChooseTournament} />
        <div className="login-layout"><EventCard tournament={bootstrap.tournament} sports={bootstrap.sports} schoolCount={bootstrap.schools.length} />
          <section className="login-card school-login-card" aria-labelledby="login-title">
            <div className="school-selection-heading"><div><h2 id="login-title"><UiIcon name="school" />우리 학교 선택</h2><p>학교를 선택한 뒤 기관번호로 로그인해 주세요.</p></div><span>전체 <b>{bootstrap.schools.length}</b>개교</span></div>
            <form className="login-form" onSubmit={submit} aria-busy={busy}>
              <label className="school-search"><span className="sr-only">학교명 검색</span><UiIcon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="학교명으로 빠르게 찾기" /></label>
              {mixedLevels && <div className="school-level-tabs" role="group" aria-label="학교급 필터"><button type="button" aria-pressed={levelFilter === "all"} onClick={() => setLevelFilter("all")}>전체 <b>{bootstrap.schools.length}</b></button>{SCHOOL_LEVELS.filter((level) => eligibleLevels.includes(level.value)).map((level) => <button type="button" key={level.value} aria-pressed={levelFilter === level.value} onClick={() => setLevelFilter(level.value as SchoolLevel)}>{level.label} <b>{bootstrap.schools.filter((school) => (school.schoolLevel ?? "middle") === level.value).length}</b></button>)}</div>}
              <div className="school-picker" role="radiogroup" aria-label="학교 선택">
                {filteredSchools.map((school) => <button key={school.id} type="button" role="radio" aria-checked={selectedSchool === school.id} disabled={busy} className={selectedSchool === school.id ? "selected" : ""} title={school.name} onClick={() => { setSelectedSchool(school.id); setError(""); }}><span className="school-order" aria-label={`${mixedLevels ? schoolLevelLabel(school.schoolLevel) : "학교"} 순번 ${school.displayOrder}`}>{String(school.displayOrder).padStart(2, "0")}</span><span className="school-label-stack"><span className="school-name">{school.name}</span>{mixedLevels && <small className="school-level-tag">{schoolLevelLabel(school.schoolLevel)}</small>}</span><i aria-hidden="true">✓</i></button>)}
                {!filteredSchools.length && <p className="school-empty">검색한 학교를 찾을 수 없습니다.</p>}
              </div>
              <div className="login-bottom"><p className="selected-school-note" aria-live="polite"><span className="selected-school-label">선택한 학교</span>{selectedName ? <b title={selectedName}>✓ {selectedName}</b> : <b>학교를 선택해 주세요</b>}</p><div className="login-controls">
                <label><span className="sr-only">기관번호 비밀번호</span><div className="password-field"><input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} placeholder="기관번호 입력" autoComplete="current-password" required disabled={busy} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 표시"}>{showPassword ? "숨김" : "보기"}</button></div></label>
                <button className="primary-action" disabled={!selectedSchool || !password || busy || !bootstrap.surveyState.open}>{busy ? "확인 중…" : "참가 신청하기"}<UiIcon name="arrow" /></button>
              </div><p className="password-help"><UiIcon name="lock" /><span>기관번호는 한글·영문 키보드 모두 입력할 수 있어요.</span></p></div>
              {error && <p className="form-error" role="alert"><SentenceFlow text={error} /></p>}
              {!bootstrap.surveyState.open && <div className="closed-notice" role="alert"><b><SentenceFlow text={bootstrap.surveyState.message} /></b><small>신청 기간은 왼쪽 대회 안내에서 확인할 수 있습니다.</small></div>}
            </form>
          </section>
        </div>
      </section>
      <footer className="site-footer"><span>인천광역시동부교육지원청 · 학교스포츠클럽 업무 지원</span><span lang="en">DONG-BU SCHOOL SPORTS</span></footer>
    </main>
  );
}

function SurveyForm({ session }: { session: SchoolSession }) {
  const initialSelections = Object.fromEntries(session.survey.selections.map((item) => [item.divisionId, item.teamCount]));
  const initialEnabled = session.sports.filter((sport) => sport.divisions.some((division) => division.id in initialSelections)).map((sport) => sport.id);
  const [selections, setSelections] = useState<Record<string, number>>(initialSelections);
  const [enabledSports, setEnabledSports] = useState<string[]>(initialEnabled);
  const [noParticipation, setNoParticipation] = useState(session.survey.noParticipation);
  const [revision, setRevision] = useState(session.survey.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [participants, setParticipants] = useState<ParticipantOverview | null>(null);
  const [participantsLoading, setParticipantsLoading] = useState(true);
  const [participantsError, setParticipantsError] = useState("");
  const [participantsRefresh, setParticipantsRefresh] = useState(0);
  const [participantSport, setParticipantSport] = useState<Sport | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setParticipantsLoading(true);
    setParticipantsError("");
    api<ParticipantOverview>(`school/participants?tournamentId=${encodeURIComponent(session.tournament.id)}&schoolId=${encodeURIComponent(session.school.id)}`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.tournamentId !== session.tournament.id) throw new Error("대회가 변경되었습니다. 다시 로그인해 주세요.");
        setParticipants(data);
      })
      .catch((requestError) => {
        if (controller.signal.aborted) return;
        setParticipants(null);
        setParticipantsError(requestError instanceof Error ? requestError.message : "참가 신청 학교를 불러오지 못했습니다.");
      })
      .finally(() => { if (!controller.signal.aborted) setParticipantsLoading(false); });
    return () => controller.abort();
  }, [session.tournament.id, session.school.id, participantsRefresh]);

  function openParticipants(sport: Sport) {
    if (busy || success) return;
    setParticipantSport(sport);
    setParticipantsLoading(true);
    setParticipantsRefresh((value) => value + 1);
  }

  function totalForSport(sport: Sport, next = selections) {
    return sport.divisions.reduce((total, division) => total + (next[division.id] ?? 0), 0);
  }

  function toggleSport(sport: Sport) {
    setError("");
    setNoParticipation(false);
    if (enabledSports.includes(sport.id)) {
      setEnabledSports((current) => current.filter((id) => id !== sport.id));
      setSelections((current) => {
        const next = { ...current };
        sport.divisions.forEach((division) => delete next[division.id]);
        return next;
      });
    } else {
      setEnabledSports((current) => [...current, sport.id]);
    }
  }

  function toggleDivision(sport: Sport, division: Division) {
    setError("");
    const next = { ...selections };
    if (next[division.id]) delete next[division.id];
    else {
      if (totalForSport(sport, next) + 1 > sport.maxTeamsPerSchool) {
        setError(`${sport.name}는 모든 종별을 합쳐 학교 전체 최대 ${sport.maxTeamsPerSchool}팀까지 선택할 수 있습니다.`);
        return;
      }
      next[division.id] = 1;
    }
    setNoParticipation(false);
    setSelections(next);
    setEnabledSports((current) => {
      const withoutSport = current.filter((id) => id !== sport.id);
      return totalForSport(sport, next) > 0 ? [...withoutSport, sport.id] : withoutSport;
    });
  }

  function setTeamCount(sport: Sport, division: Division, count: number) {
    setSelections((current) => {
      if (!Number.isInteger(count) || count < 1 || count > sport.maxTeamsPerDivision) {
        setError(`${sport.name} ${division.name}는 한 종별에서 최대 ${sport.maxTeamsPerDivision}팀까지 선택할 수 있습니다.`);
        return current;
      }
      const next = { ...current, [division.id]: count };
      if (totalForSport(sport, next) > sport.maxTeamsPerSchool) {
        setError(`${sport.name}는 모든 종별을 합쳐 학교 전체 최대 ${sport.maxTeamsPerSchool}팀까지 선택할 수 있습니다.`);
        return current;
      }
      setError("");
      return next;
    });
  }

  function chooseNoParticipation() {
    setNoParticipation(true);
    setSelections({});
    setEnabledSports([]);
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!noParticipation) {
      if (!enabledSports.length) {
        setError("참가 종목을 선택하거나 '참가 신청 없음'을 선택해 주세요.");
        return;
      }
      const incomplete = session.sports.find((sport) => enabledSports.includes(sport.id) && !sport.divisions.some((division) => selections[division.id]));
      if (incomplete) {
        setError(`${incomplete.name}의 종별을 1개 이상 선택해 주세요.`);
        return;
      }
      for (const sport of session.sports.filter((candidate) => enabledSports.includes(candidate.id))) {
        const invalidDivision = sport.divisions.find((division) => (selections[division.id] ?? 0) > sport.maxTeamsPerDivision);
        if (invalidDivision) {
          setError(`${sport.name} ${invalidDivision.name}의 기존 신청 팀 수를 ${sport.maxTeamsPerDivision}팀 이하로 수정해 주세요.`);
          return;
        }
        if (totalForSport(sport) > sport.maxTeamsPerSchool) {
          setError(`${sport.name}는 모든 종별을 합쳐 학교 전체 최대 ${sport.maxTeamsPerSchool}팀까지 선택할 수 있습니다.`);
          return;
        }
      }
    }
    setBusy(true);
    try {
      const saved = await api<{ ok: true; survey: Survey }>("school/survey", {
        method: "PUT",
        body: JSON.stringify({
          tournamentId: session.tournament.id,
          schoolId: session.school.id,
          revision,
          noParticipation,
          selections: Object.entries(selections).map(([divisionId, teamCount]) => ({ divisionId, teamCount })),
        }),
      });
      setRevision(saved.survey.revision);
      setSuccess(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "저장하지 못했습니다.");
    } finally { setBusy(false); }
  }

  async function leave(chooseAnother = false) {
    if (busy) return;
    if (chooseAnother && !window.confirm("저장하지 않은 변경 내용은 반영되지 않습니다. 대회 선택 화면으로 이동할까요?")) return;
    try { await api("school/logout", { method: "POST", body: "{}" }); }
    finally { window.location.replace(chooseAnother ? "/" : `/?tournamentId=${encodeURIComponent(session.tournament.id)}`); }
  }

  return (
    <main className="survey-shell">
      <header className="survey-topbar"><Brand tournament={session.tournament} /><div className="survey-account"><span>{session.school.name.slice(0, 1)}</span><p><b title={session.school.name}>{session.school.name}</b><small>학교 참가 신청</small></p><button type="button" disabled={busy} onClick={() => void leave(true)}>다른 대회 선택</button><button type="button" disabled={busy} onClick={() => void leave()}>로그아웃</button></div></header>
      <form className="survey-content" onSubmit={save}>
        <section className="application-heading"><div><span className="academic-year-badge">{session.tournament.academicYear}학년도</span><h1><small>{session.school.name}</small>우리 학교 참가 신청</h1><p><SentenceFlow text={session.tournament.name} /></p></div><ApplicationSteps current={2} /></section>
        <div className="application-period"><UiIcon name="calendar" /><b>신청 기간</b><span className="period-date">{formatDate(session.tournament.surveyStart)}</span><span className="period-date">— {formatDate(session.tournament.surveyEnd)}</span><small>한국시간</small></div>
        {session.survey.submitted && <div className="prefill-banner"><span>✓</span><p><b>기존 신청 내용을 불러왔습니다.</b><small className="prefill-meta"><span>마지막 저장 {formatDate(session.survey.updatedAt)}</span><span>· 변경 후 다시 저장해 주세요.</span></small></p></div>}

        <div className="application-layout"><div className="application-main">
        <div className="intent-control"><span>이번 대회 참가 여부</span><div className="intent-options" role="group" aria-label="참가 여부"><button type="button" aria-pressed={!noParticipation} disabled={busy} onClick={() => { setNoParticipation(false); setError(""); }}>참가 신청합니다</button><button type="button" aria-pressed={noParticipation} disabled={busy} onClick={chooseNoParticipation}>참가 신청하지 않습니다</button></div></div>
        {noParticipation ? <><section className="application-none"><UiIcon name="school" /><h2>이번 대회는 참가 신청하지 않습니다.</h2><p>‘참가 신청 저장’을 누르면<br />우리 학교가 신청 완료로 집계됩니다.</p></section><section className="participant-none-overview" aria-label="종목별 참가 신청 학교 현황">{session.sports.map((sport) => <article key={sport.id}><h3>{sport.name}</h3><ParticipantSportLink sport={sport} data={participants?.sports.find((item) => item.id === sport.id)} loading={participantsLoading} error={participantsError} disabled={busy || success} onOpen={() => openParticipants(sport)} /></article>)}</section></> : <section className="sports-grid">
          {session.sports.map((sport, index) => {
            const enabled = enabledSports.includes(sport.id);
            const total = totalForSport(sport);
            return <article className={`sport-card ${enabled ? "enabled" : ""}`} key={sport.id}>
              <header><div className="sport-name-block"><h2 title={sport.name}>{sport.name}</h2><small lang="en">{sport.name === "배구" ? "VOLLEYBALL" : /3[x×]3/.test(sport.name) ? "BASKETBALL" : sport.name === "피구" ? "DODGEBALL" : `SPORT ${String(index + 1).padStart(2, "0")}`}</small></div><button type="button" role="switch" aria-label={`${sport.name} 참가`} aria-checked={enabled} onClick={() => toggleSport(sport)} disabled={busy}><i /><b>{enabled ? "참가" : "미선택"}</b></button></header>
              <div className="sport-rules"><span>학교 합계 <b>최대 {sport.maxTeamsPerSchool}팀</b></span><span>종별 <b>최대 {sport.maxTeamsPerDivision}팀</b></span></div>
              <div className="sport-options"><div className="division-grid">{sport.divisions.map((division) => {
                const selected = Boolean(selections[division.id]);
                const currentCount = selections[division.id] ?? 1;
                const otherDivisionTotal = total - (selected ? currentCount : 0);
                const selectableMaximum = Math.max(0, Math.min(sport.maxTeamsPerDivision, sport.maxTeamsPerSchool - otherDivisionTotal));
                const selectableCounts = Array.from({ length: selectableMaximum }, (_, teamIndex) => teamIndex + 1);
                const currentNeedsCorrection = currentCount > selectableMaximum;
                if (currentNeedsCorrection) selectableCounts.push(currentCount);
                const showTeamCountControl = selected && (sport.maxTeamsPerDivision >= 2 || currentCount > sport.maxTeamsPerDivision);
                return <div className={`division-row ${selected ? "selected" : ""}`} key={division.id}><button type="button" role="checkbox" aria-checked={selected} title={division.name} aria-label={`${sport.name} ${division.name} 참가`} disabled={busy} onClick={() => toggleDivision(sport, division)}><span>{selected ? "✓" : ""}</span><b>{division.name}</b></button>{showTeamCountControl && (sport.maxTeamsPerDivision <= 3 && !currentNeedsCorrection ? <div className="division-teams" role="group" aria-label={`${sport.name} ${division.name} 참가팀 수`}>{Array.from({ length: sport.maxTeamsPerDivision }, (_, n) => n + 1).map((count) => <button type="button" key={count} aria-pressed={currentCount === count} disabled={busy || count > selectableMaximum} onClick={() => setTeamCount(sport, division, count)}>{count}팀</button>)}</div> : <label><span>참가팀 수</span><select aria-label={`${sport.name} ${division.name} 참가팀 수`} value={currentCount} disabled={busy} onChange={(event) => setTeamCount(sport, division, Number(event.target.value))}>{selectableCounts.map((count) => <option key={count} value={count} disabled={count > selectableMaximum}>{count}팀{count > selectableMaximum ? " · 기존 신청, 수정 필요" : ""}</option>)}</select></label>)}{!selected && <small className="division-empty">선택 안 함</small>}</div>;
              })}</div>{enabled && <p className="team-limit"><span className="team-limit-current">현재 {total}팀</span><span className="team-limit-maximum" title={teamLimitLabel(sport)}>{compactTeamLimitLabel(sport)}</span></p>}</div>
              <ParticipantSportLink sport={sport} data={participants?.sports.find((item) => item.id === sport.id)} loading={participantsLoading} error={participantsError} disabled={busy || success} onOpen={() => openParticipants(sport)} />
            </article>;
          })}
        </section>}
        </div><aside className="application-summary" aria-label="신청 내용 요약"><header><small>APPLICATION SUMMARY</small><h2>우리 학교 신청 내역</h2><p>선택한 내용을 한 번 더 확인해 주세요.</p></header><div className="application-summary-body"><div className="summary-school"><UiIcon name="school" />{session.school.name}</div><div className="summary-selections" aria-live="polite">{!noParticipation && session.sports.filter((sport) => totalForSport(sport) > 0).map((sport) => <div key={sport.id}><b>{sport.name}</b><p>{sport.divisions.filter((division) => selections[division.id]).map((division) => <span key={division.id}>{division.name} <b>{selections[division.id]}팀</b></span>)}</p></div>)}{(noParticipation || !Object.keys(selections).length) && <p className="summary-empty">{noParticipation ? "이번 대회 참가 신청 없음" : "참가할 종별을 선택해 주세요."}</p>}</div><div className="summary-total"><span>{noParticipation ? "참가 신청 없음" : "총 신청 팀"}</span><b>{noParticipation ? 0 : Object.values(selections).reduce((sum, count) => sum + count, 0)}<small>팀</small></b></div>{error && <p className="survey-error summary-error" role="alert"><span className="survey-error-message"><SentenceFlow text={error} /></span></p>}<button className="save-button" disabled={busy}>{busy ? "저장 중…" : session.survey.submitted ? "변경 내용 저장" : "참가 신청 저장"}<UiIcon name="check" /></button><p className="summary-note">신청 기간 안에는 다시 로그인해<br />수정할 수 있어요.</p></div></aside></div>
      </form>
      {success && <SaveConfirmation school={session.school.name} tournament={session.tournament.name} onConfirm={leave} />}
      {participantSport && <SchoolParticipantsDialog key={participantSport.id} sport={participantSport} data={participants?.sports.find((sport) => sport.id === participantSport.id) ?? null} loading={participantsLoading} error={participantsError} queriedAt={participants?.queriedAt ?? null} onRefresh={() => { setParticipantsLoading(true); setParticipantsRefresh((value) => value + 1); }} onClose={() => setParticipantSport(null)} />}
    </main>
  );
}

function ParticipantSportLink({ sport, data, loading, error, disabled, onOpen }: { sport: Sport; data?: SportParticipants; loading: boolean; error: string; disabled: boolean; onOpen: () => void }) {
  return <div className="participant-sport-strip">
    <div><span className="participant-strip-label">저장된 신청</span><b>{loading ? "현황 확인 중…" : error || !data ? "현황을 확인해 주세요" : `${data.schoolCount}개교 · ${data.teamCount}팀`}</b></div>
    <button type="button" className="participant-open-button" aria-label={`${sport.name} 참가 신청 학교 보기`} aria-haspopup="dialog" aria-controls="school-participants-dialog" disabled={disabled} onClick={onOpen}>참가 신청 학교 보기 <UiIcon name="arrow" /></button>
  </div>;
}

function SchoolParticipantsDialog({ sport, data, loading, error, queriedAt, onRefresh, onClose }: { sport: Sport; data: SportParticipants | null; loading: boolean; error: string; queriedAt: string | null; onRefresh: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [divisionId, setDivisionId] = useState("all");
  const selectedDivision = data?.divisions.find((division) => division.id === divisionId);
  const selectedId = selectedDivision?.id ?? "all";
  const visibleSchools = data?.schools.filter((school) => selectedId === "all" || school.selections.some((selection) => selection.divisionId === selectedId)) ?? [];
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = document.body;
    const root = document.documentElement;
    const scrollY = window.scrollY;
    const width = Math.max(0, window.innerWidth - root.clientWidth);
    const beforeBody = { overflow: body.style.overflow, position: body.style.position, top: body.style.top, width: body.style.width, paddingRight: body.style.paddingRight };
    const beforeRoot = { overflow: root.style.overflow, overscrollBehavior: root.style.overscrollBehavior, scrollBehavior: root.style.scrollBehavior };
    Object.assign(body.style, { overflow: "hidden", position: "fixed", top: `-${scrollY}px`, width: "100%", ...(width ? { paddingRight: `${width}px` } : {}) });
    Object.assign(root.style, { overflow: "hidden", overscrollBehavior: "none" });
    element?.showModal();
    return () => {
      element?.close();
      Object.assign(body.style, beforeBody);
      Object.assign(root.style, beforeRoot, { scrollBehavior: "auto" });
      window.scrollTo(0, scrollY);
      trigger?.focus({ preventScroll: true });
      root.style.scrollBehavior = beforeRoot.scrollBehavior;
    };
  }, []);
  const schoolCount = selectedDivision?.schoolCount ?? data?.schoolCount ?? 0;
  const teamCount = selectedDivision?.teamCount ?? data?.teamCount ?? 0;
  const available = !loading && !error && data !== null;
  return <dialog ref={dialog} id="school-participants-dialog" className="school-participants-dialog" aria-labelledby="school-participants-title" aria-describedby="school-participants-note" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <section className="school-participants-surface">
      <header><div><p>PARTICIPATING SCHOOLS</p><h2 id="school-participants-title">{sport.name} <span>참가 신청 학교</span></h2></div><button type="button" className="participants-close" aria-label="참가 신청 학교 창 닫기" onClick={onClose}>×</button></header>
      <p id="school-participants-note">저장 완료된 신청만 표시됩니다. 신청 기간 중에는 바뀔 수 있습니다.</p>
      <div className="participant-filter" role="group" aria-label="참가 종별 필터"><button type="button" aria-pressed={selectedId === "all"} onClick={() => setDivisionId("all")}>전체</button>{(data?.divisions ?? sport.divisions).map((division) => <button type="button" key={division.id} aria-pressed={selectedId === division.id} onClick={() => setDivisionId(division.id)}>{division.name}</button>)}</div>
      <div className="participant-dialog-stats" aria-live="polite"><div><b>{available ? schoolCount : "—"}</b><span>참가 학교</span></div><div><b>{available ? teamCount : "—"}</b><span>신청 팀</span></div>{available && <p>{selectedDivision ? selectedDivision.name : data.divisions.map((division) => `${division.name} ${division.teamCount}팀`).join(" · ")}</p>}</div>
      <div className="participant-dialog-list" aria-busy={loading} aria-live="polite">
        {loading ? <div className="participant-empty"><span className="loading-ring" /><b>참가 신청 학교를 확인하고 있습니다.</b></div> : error || !data ? <div className="participant-empty" role="alert"><b><SentenceFlow text={error || "현황을 불러오지 못했습니다."} /></b><button type="button" className="outline-button" onClick={onRefresh}>다시 불러오기</button></div> : !visibleSchools.length ? <div className="participant-empty"><UiIcon name="school" /><b>아직 참가 신청한 학교가 없습니다.</b><p>{selectedDivision ? `${selectedDivision.name}에 저장된 신청이 없습니다.` : "이 종목의 첫 신청을 기다리고 있어요."}</p></div> : <ul>{visibleSchools.map((school) => {
          const selections = school.selections.filter((selection) => selectedId === "all" || selection.divisionId === selectedId);
          return <li key={school.schoolId} className={school.isOwnSchool ? "is-own-school" : ""}><div className="participant-school-name"><b>{school.schoolName}</b>{school.schoolLevel && <small className="school-level-tag">{schoolLevelLabel(school.schoolLevel)}</small>}{school.isOwnSchool && <span>우리 학교</span>}</div><div className="participant-school-teams">{selections.map((selection) => <span key={selection.divisionId}>{selection.divisionName} <b>{selection.teamCount}팀</b></span>)}</div><b className="participant-school-total">{selections.reduce((sum, selection) => sum + selection.teamCount, 0)}<small>팀</small></b></li>;
        })}</ul>}
      </div>
      <footer><div><small>{queriedAt && !error ? `${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(queriedAt))} 조회` : "저장된 신청 기준"}</small><button type="button" onClick={onRefresh} disabled={loading}>현황 새로고침</button></div><button type="button" className="solid-button" onClick={onClose}>닫기</button></footer>
    </section>
  </dialog>;
}

function SaveConfirmation({ school, tournament, onConfirm }: { school: string; tournament: string; onConfirm: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    element?.showModal();
    return () => { element?.close(); root.style.overflow = previous; };
  }, []);
  return <dialog ref={dialog} className="save-dialog" aria-labelledby="success-title" onCancel={(event) => event.preventDefault()}><section className="success-modal"><span className="success-mark">✓</span><p>APPLICATION SAVED</p><h2 id="success-title">저장되었습니다.</h2><div><b>{school}</b><small>{tournament} 참가 신청</small></div><p className="modal-copy">확인을 누르면 로그아웃되고 처음 로그인 화면으로 이동합니다.</p><button type="button" disabled={leaving} onClick={() => { setLeaving(true); void onConfirm(); }}>{leaving ? "이동 중…" : "확인"}</button></section></dialog>;
}

function EventCardEditor({ tournament, sports, schoolCount, busy, onSave }: { tournament: Tournament; sports: Sport[]; schoolCount: number; busy: boolean; onSave: (copy: Record<string, string>) => Promise<void> }) {
  const [copy, setCopy] = useState<Record<string, string>>(() => eventCardCopy(tournament));
  function resetDefaults() {
    setCopy(eventCardCopy({ ...tournament, cardCopy: "{}" }));
  }
  return <article className="settings-card event-card-editor"><header><span>04</span><div><p>LOGIN PAGE CARD</p><h2>메인페이지 안내 카드 문구</h2></div></header><p>왼쪽 대회 안내 카드의 문구를 수정할 수 있습니다. 모든 문구는 카드 안에서 좌우 중앙정렬됩니다.</p><div className="card-editor-layout"><form onSubmit={(event) => { event.preventDefault(); void onSave(copy); }} aria-busy={busy}><div className="card-editor-fields">{EVENT_CARD_FIELDS.map((field) => <label key={field.key} className={["title", "subtitle", "description", "target", "footer"].includes(field.key) ? "wide" : ""}><span>{field.label}</span>{["title", "subtitle", "description"].includes(field.key) ? <textarea value={copy[field.key] ?? ""} maxLength={field.max} rows={2} disabled={busy} onChange={(event) => setCopy((current) => ({ ...current, [field.key]: event.target.value }))} /> : <input value={copy[field.key] ?? ""} maxLength={field.max} disabled={busy} onChange={(event) => setCopy((current) => ({ ...current, [field.key]: event.target.value }))} />}<small>{field.max}자 이내 · 비워 두면 숨김</small></label>)}</div><p className="card-editor-note"><SentenceFlow text="신청 기간·종목·학교 수는 실제 대회 설정에 따라 자동으로 표시됩니다. 아래 버튼으로 저장해야 교사 화면에 반영됩니다." /></p><footer><button type="button" className="outline-button" disabled={busy} onClick={resetDefaults}>기본 문구 불러오기</button><button type="submit" className="solid-button" disabled={busy}>{busy ? "저장 중…" : "안내 카드 문구 저장"}</button></footer></form><div className="card-editor-preview"><p>교사 화면 미리보기 · 저장 전</p><EventCard tournament={tournament} sports={sports} schoolCount={schoolCount} copy={copy} /></div></div></article>;
}

async function prepareLogoImage(file: File): Promise<{ blob: Blob; preview: string }> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type.toLowerCase())) throw new Error("PNG·JPG·WebP 사진을 선택해 주세요.");
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error("10MB 이하의 사진을 선택해 주세요.");
  const readDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("사진을 읽지 못했습니다. 다시 선택해 주세요."));
    reader.readAsDataURL(blob);
  });
  const source = await readDataUrl(file);
  const picture = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("열 수 없는 사진입니다. 다른 이미지 파일을 선택해 주세요."));
    img.src = source;
  });
  if (!picture.naturalWidth || !picture.naturalHeight || picture.naturalWidth * picture.naturalHeight > 40_000_000) throw new Error("사진의 해상도가 너무 큽니다. 크기를 줄인 뒤 다시 선택해 주세요.");
  const scale = Math.min(1, 512 / Math.max(picture.naturalWidth, picture.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이 브라우저에서 사진을 처리할 수 없습니다.");
  context.drawImage(picture, 0, 0, canvas.width, canvas.height);
  const encoded = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("사진 변환에 실패했습니다.")), "image/png"));
  const blob = new Blob([cleanCanvasPngBytes(new Uint8Array(await encoded.arrayBuffer()))], { type: "image/png" });
  if (blob.size > 2 * 1024 * 1024) throw new Error("사진의 용량을 줄인 뒤 다시 선택해 주세요.");
  return { blob, preview: await readDataUrl(blob) };
}

function LogoImageEditor({ tournament, busy, onSave }: { tournament: Tournament; busy: boolean; onSave: (image: Blob | null) => Promise<void> }) {
  const [draft, setDraft] = useState<{ blob: Blob; preview: string; name: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef(0);
  useEffect(() => () => { selectionRef.current += 1; }, []);
  const disabled = busy || preparing || saving;

  async function choose(file?: File) {
    if (!file) return;
    const selection = ++selectionRef.current;
    setPreparing(true); setError(""); setNotice(""); setDraft(null);
    try {
      const prepared = await prepareLogoImage(file);
      if (selection === selectionRef.current) setDraft({ ...prepared, name: file.name });
    } catch (reason) {
      if (selection === selectionRef.current) setError(reason instanceof Error ? reason.message : "사진을 준비하지 못했습니다.");
    } finally {
      if (selection === selectionRef.current) { setPreparing(false); if (inputRef.current) inputRef.current.value = ""; }
    }
  }

  async function save(remove = false) {
    if (disabled || (!remove && !draft)) return;
    if (remove && !window.confirm("저장된 로고 이미지를 삭제하고 문자 로고로 되돌릴까요?")) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await onSave(remove ? null : draft!.blob);
      setDraft(null);
      setNotice(remove ? "로고 이미지를 삭제했습니다. 기존 문자 로고가 표시됩니다." : "로고 이미지를 저장했습니다. 현재 대회라면 메인페이지에 반영됩니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "로고를 저장하지 못했습니다."); }
    finally { setSaving(false); }
  }

  return <section className="logo-image-editor" aria-label="상단 로고 이미지 설정" aria-busy={disabled}>
    <div className="logo-image-controls">
      <h3>로고 이미지</h3>
      <p><SentenceFlow text="사진을 선택한 뒤 ‘로고 이미지 저장’을 누르세요. 이미지가 없으면 아래에 설정한 문자 로고가 표시됩니다." /></p>
      <label className="logo-file-label"><span>이미지 파일 선택</span><input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} aria-describedby={`logo-help-${tournament.id}`} onChange={(event) => { void choose(event.target.files?.[0]); }} /></label>
      <small id={`logo-help-${tournament.id}`}>PNG·JPG·WebP · 최대 10MB · 비율 유지, 최대 512px로 자동 최적화</small>
      {draft && <p className="logo-file-name" title={draft.name}>선택한 파일: {draft.name}</p>}
      <div className="logo-image-actions">
        <button type="button" className="solid-button" disabled={disabled || !draft} onClick={() => { void save(); }}>{preparing ? "사진 준비 중…" : saving ? "처리 중…" : "로고 이미지 저장"}</button>
        {draft && <button type="button" className="outline-button" disabled={disabled} onClick={() => { setDraft(null); setError(""); setNotice(""); }}>선택 취소</button>}
        {tournament.logoKey && <button type="button" className="outline-button" disabled={disabled} onClick={() => { void save(true); }}>이미지 삭제</button>}
      </div>
      {error && <p className="form-error" role="alert"><SentenceFlow text={error} /></p>}
      {notice && <p className="logo-save-notice" role="status"><SentenceFlow text={notice} /></p>}
    </div>
    <div className="logo-image-preview"><p>{draft ? "선택한 이미지 · 저장 전" : "현재 저장된 로고"}</p><Brand tournament={tournament} imageUrl={draft?.preview} preview /><small>메인페이지 표시 예시 · 사진 전체를 비율에 맞춰 표시합니다.</small></div>
  </section>;
}

function PageHeaderEditor({ tournament, busy, onSave, onSaveLogo }: { tournament: Tournament; busy: boolean; onSave: (copy: Record<string, string>) => Promise<void>; onSaveLogo: (image: Blob | null) => Promise<void> }) {
  const [copy, setCopy] = useState<Record<string, string>>(() => pageHeaderCopy(tournament));
  return <article className="settings-card page-header-editor">
    <header><span>03</span><div><p>LOGIN PAGE HEADER</p><h2>메인페이지 상단 로고·제목</h2></div></header>
    <p><SentenceFlow text="메인페이지 맨 위의 로고와 기관명, 학년도 배지 옆 문구, 두 줄 제목을 수정합니다. 선택한 대회에만 저장됩니다. 로고·기관명·기관명 아래 문구는 관리자 화면과 교사 화면에 공통으로 반영됩니다." /></p>
    <LogoImageEditor key={tournament.id} tournament={tournament} busy={busy} onSave={onSaveLogo} />
    <form onSubmit={(event) => { event.preventDefault(); void onSave(copy); }} aria-busy={busy}>
      <div className="card-editor-fields">{PAGE_HEADER_FIELDS.map((field) => <label key={field.key}>
        <span>{field.label}{field.required && " · 필수"}</span>
        {field.multiline
          ? <textarea value={copy[field.key] ?? ""} maxLength={field.max} rows={2} required={field.required} disabled={busy} onChange={(event) => setCopy((current) => ({ ...current, [field.key]: event.target.value }))} />
          : <input value={copy[field.key] ?? ""} maxLength={field.max} required={field.required} disabled={busy} onChange={(event) => setCopy((current) => ({ ...current, [field.key]: event.target.value }))} />}
        <small>{field.key === "logoText" ? "이미지가 없을 때 표시 · 한글·영문·숫자 1~3자" : `${field.max}자 이내${field.required ? "" : " · 비워 두면 숨김"}`}</small>
      </label>)}</div>
      <p className="card-editor-note"><SentenceFlow text={`학년도 배지는 현재 ${tournament.academicYear}학년도입니다. 위쪽 ‘대회 정보·신청 기간’의 학년도를 변경하고 저장하면 함께 바뀝니다. 상단 문구는 아래 저장 버튼을 눌러야 반영됩니다.`} /></p>
      <section className="page-header-preview redesigned-login" aria-label="메인페이지 상단 미리보기">
        <p className="header-preview-label">교사 화면 미리보기 · 저장 전</p>
        <div className="header-preview-brand"><Brand tournament={tournament} copy={copy} preview /></div>
        <ApplicationIntro tournament={tournament} copy={copy} preview />
      </section>
      <footer><button type="button" className="outline-button" disabled={busy} onClick={() => setCopy(pageHeaderCopy(null))}>기본 문구 불러오기</button><button type="submit" className="solid-button" disabled={busy}>{busy ? "저장 중…" : "상단 로고·제목 저장"}</button></footer>
    </form>
  </article>;
}

function AdminLogin({ tournament, onLogin }: { tournament: Tournament | null; onLogin: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("accountChanged") !== "1") return;
    const timer = window.setTimeout(() => {
      setNotice("계정 정보가 변경되었습니다. 새 아이디와 비밀번호로 로그인해 주세요.");
    }, 0);
    url.searchParams.delete("accountChanged");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      await api("admin/login", { method: "POST", body: JSON.stringify({ username: data.get("username"), password: data.get("password") }) });
      await onLogin();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "로그인하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <main className="site-shell admin-login-shell"><header className="brand-bar"><Brand admin tournament={tournament} /><a className="admin-link" href="/">교사용 페이지</a></header><section className="admin-login-stage"><div><p className="eyebrow"><span /> ADMINISTRATION</p><h1 className="admin-login-title"><span>참가 신청을</span><span>한눈에 관리하세요.</span></h1><p className="admin-login-copy">대회·신청 기간·대상 학교·종목을 설정하고 학교별 신청 현황을 실시간으로 확인합니다.</p></div><section className="login-card admin-login-card"><div className="card-accent" /><div className="card-heading"><span className="step-badge">A</span><div><p>SECURE ACCESS</p><h2>관리자 로그인</h2></div></div>{notice && <p className="login-status" role="status">✓ <SentenceFlow text={notice} /></p>}<form className="login-form" onSubmit={submit}><label><span>관리자 아이디</span><input name="username" autoComplete="username" required /></label><label><span>비밀번호</span><input name="password" type="password" autoComplete="current-password" required /></label>{error && <p className="form-error" role="alert"><SentenceFlow text={error} /></p>}<button className="primary-action" disabled={busy}>{busy ? "확인 중…" : "관리자 화면 열기"}<span>→</span></button></form><div className="security-note"><span>✓</span><p><b>관리자 전용</b><small>모든 관리 기능은 서버에서 권한을 다시 확인합니다.</small></p></div></section></section></main>;
}

function AdminAccountSettings({ currentUsername }: { currentUsername: string }) {
  const [username, setUsername] = useState(currentUsername);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const normalizedUsername = username.trim().normalize("NFC");
    if (!/^[\p{L}\p{N}._-]{3,40}$/u.test(normalizedUsername)) {
      setError("관리자 아이디는 공백 없이 3~40자로 입력해 주세요.");
      return;
    }
    if (newPassword && [...newPassword].length < 8) {
      setError("새 비밀번호는 8자 이상으로 입력해 주세요.");
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setError("새 비밀번호가 서로 일치하지 않습니다.");
      return;
    }
    if (normalizedUsername === currentUsername && !newPassword) {
      setError("변경할 아이디 또는 새 비밀번호를 입력해 주세요.");
      return;
    }
    const usernameSummary = normalizedUsername === currentUsername
      ? "아이디: 유지"
      : `아이디: ${currentUsername} → ${normalizedUsername}`;
    const passwordSummary = newPassword ? "비밀번호: 변경" : "비밀번호: 유지";
    const confirmed = window.confirm(
      `관리자 계정 정보를 변경할까요?\n\n${usernameSummary}\n${passwordSummary}\n\n변경하면 모든 관리자 기기에서 로그아웃됩니다. 새 계정 정보로 다시 로그인해 주세요.`,
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      await api("admin/credentials", {
        method: "PATCH",
        body: JSON.stringify({
          username: normalizedUsername,
          currentPassword,
          newPassword,
          newPasswordConfirm,
        }),
      });
      window.location.replace("/admin?accountChanged=1");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "계정 정보를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setCurrentPassword("");
    } finally {
      setBusy(false);
    }
  }

  return <section className="admin-settings-grid account-settings">
    <article className="settings-card account-card">
      <header><span>01</span><div><p>ADMIN ACCOUNT</p><h2>관리자 로그인 정보</h2></div></header>
      <p className="prose-copy">
        <span className="sentence-unit">관리자 아이디와 비밀번호를 변경할 수 있습니다.</span>
        {" "}
        <span className="sentence-unit">저장하려면 현재 비밀번호를 입력해 주세요.</span>
      </p>
      <form onSubmit={(event) => void submit(event)} aria-busy={busy}>
        <label><span>관리자 아이디</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={40} required /><small>공백 없이 3~40자로 입력해 주세요.</small></label>
        <label><span>현재 비밀번호</span><input value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} type={showPasswords ? "text" : "password"} autoComplete="current-password" required /></label>
        <div className="form-two">
          <label><span>새 비밀번호</span><input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type={showPasswords ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={128} /><small className="prose-copy"><span className="sentence-unit">변경하지 않으려면 비워 두세요.</span>{" "}<span className="sentence-unit">8자 이상 입력해 주세요.</span></small></label>
          <label><span>새 비밀번호 확인</span><input value={newPasswordConfirm} onChange={(event) => setNewPasswordConfirm(event.target.value)} type={showPasswords ? "text" : "password"} autoComplete="new-password" maxLength={128} /></label>
        </div>
        <label className="check-label account-password-toggle"><input type="checkbox" checked={showPasswords} onChange={(event) => setShowPasswords(event.target.checked)} /><span>입력한 비밀번호 표시</span></label>
        <div className="account-warning"><span>!</span><p><b>변경 후 모든 관리자 기기에서 로그아웃됩니다.</b><small>새 아이디와 비밀번호로 다시 로그인해 주세요.</small></p></div>
        {error && <p className="form-error account-error" role="alert"><SentenceFlow text={error} /></p>}
        <footer><button type="submit" className="solid-button" disabled={busy}>{busy ? "변경 중…" : "계정 정보 변경"}</button></footer>
      </form>
    </article>
  </section>;
}

function SportSymbol({ sport, className = "" }: { sport: Pick<Sport, "name" | "iconKey">; className?: string }) {
  const icon = resolveSportIcon(sport.iconKey, sport.name);
  return <span className={`sport-symbol ${className}`} aria-hidden="true"><img src={icon.src} alt="" width="40" height="40" decoding="async" /></span>;
}

function SportIconPicker({ name, iconKey, groupId, busy, onChange }: { name: string; iconKey: string; groupId: string; busy: boolean; onChange: (key: string) => void }) {
  const selected = resolveSportIcon(iconKey, name);
  const choices = [{ key: "auto", label: "종목명에 맞춰 자동", src: resolveSportIcon("auto", name).src }, ...SPORT_ICONS.map((icon) => ({ ...icon, src: resolveSportIcon(icon.key, name).src }))];
  return <fieldset className="sport-icon-picker" disabled={busy}>
    <legend>종목 그림 <small>공·상징 선택</small></legend>
    <div className="sport-icon-preview" aria-live="polite"><SportSymbol sport={{ name, iconKey }} /><div><b>{iconKey === "auto" ? "종목명에 맞춰 자동 선택" : selected.label}</b><small>{iconKey === "auto" ? `현재 그림: ${selected.label}` : "이 그림을 종목 배너에 표시합니다."}</small></div></div>
    <details><summary>종목 그림 선택 <span>{SPORT_ICONS.length - 1}개 종목 · 공통 그림</span></summary><div className="sport-icon-options">
      {choices.map((icon) => <label key={icon.key} className={`sport-icon-option${iconKey === icon.key ? " selected" : ""}`}>
        <input type="radio" name={`sport-icon-${groupId}`} value={icon.key} checked={iconKey === icon.key} onChange={() => onChange(icon.key)} />
        <span className="sport-icon-choice-body"><img src={icon.src} alt="" width="36" height="36" loading="lazy" /><b>{icon.label}</b><small aria-hidden="true">{iconKey === icon.key ? "✓ 선택됨" : "선택"}</small></span>
      </label>)}
    </div></details>
    <p>자동 선택은 종목명이 바뀌면 그림도 바뀝니다. 직접 선택한 그림은 종목명을 수정해도 유지됩니다.</p>
  </fieldset>;
}

function SportEditor({ sport, levels, isNew = false, busy, onSave, onCancel }: {
  sport: Sport;
  levels: SchoolLevel[];
  isNew?: boolean;
  busy: boolean;
  onSave: (payload: SportUpdatePayload) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(sport.name);
  const [iconKey, setIconKey] = useState(sport.iconKey ?? "auto");
  const [maxTeamsPerSchool, setMaxTeamsPerSchool] = useState(sport.maxTeamsPerSchool);
  const [maxTeamsPerDivision, setMaxTeamsPerDivision] = useState(sport.maxTeamsPerDivision);
  const [divisions, setDivisions] = useState<DivisionDraft[]>(() => {
    const existing = sport.divisions.map((division) => ({ key: division.id, id: division.id, name: division.name, schoolLevel: division.schoolLevel ?? "middle" as SchoolLevel }));
    return existing.length ? existing : SCHOOL_LEVELS.filter((level) => levels.includes(level.value as SchoolLevel)).flatMap((level) => [level.maleDivision, level.femaleDivision].map((name, index) => ({ key: `new-${level.value}-${index}`, name, schoolLevel: level.value as SchoolLevel })));
  });

  function updateDivision(key: string, values: Partial<Pick<DivisionDraft, "name" | "schoolLevel">>) {
    setDivisions((current) => current.map((division) => division.key === key ? { ...division, ...values } : division));
  }

  function addDivision() {
    setDivisions((current) => current.length >= 8
      ? current
      : [...current, { key: `new-${Date.now()}-${current.length}`, name: "", schoolLevel: levels[0] }]);
  }

  function removeDivision(key: string) {
    setDivisions((current) => current.length === 1 ? current : current.filter((division) => division.key !== key));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSave({
      name,
      iconKey,
      divisions: divisions.map((division) => ({ id: division.id, name: division.name, schoolLevel: division.schoolLevel })),
      maxTeamsPerSchool,
      maxTeamsPerDivision,
    });
  }

  return <form className="sport-editor" onSubmit={(event) => void submit(event)}>
    <div className="sport-editor-grid">
      <label><span>종목명</span><input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} required /></label>
      <div className="team-limit-field-grid">
        <label><span>학교 전체 최대 팀 수</span><input type="number" min="1" max="20" value={maxTeamsPerSchool} onChange={(event) => setMaxTeamsPerSchool(Number(event.target.value))} required /></label>
        <label><span>한 종별 최대 팀 수</span><input type="number" min="1" max={maxTeamsPerSchool || 20} value={maxTeamsPerDivision} onChange={(event) => setMaxTeamsPerDivision(Number(event.target.value))} required /></label>
      </div>
    </div>
    <p className="team-limit-rule-note"><b>학교 전체</b>는 모든 종별의 합계이고, <b>한 종별</b>은 남자부·여자부 등 각 종별의 한도입니다.</p>
    <SportIconPicker name={name} iconKey={iconKey} groupId={sport.id} busy={busy} onChange={setIconKey} />
    <fieldset className="sport-divisions">
      <legend>종별 <small>학교급별로 구분</small></legend>
      <div className="sport-division-list">
        {divisions.map((division, index) => <div className="sport-division-row school-level-division-row" key={division.key}>
          {levels.length > 1 ? <label className="division-school-level"><span className="sr-only">종별 {index + 1} 학교급</span><select value={division.schoolLevel} disabled={busy} onChange={(event) => updateDivision(division.key, { schoolLevel: event.target.value as SchoolLevel })}>{levels.map((level) => <option key={level} value={level}>{schoolLevelLabel(level)}</option>)}</select></label> : <span className="school-level-chip">{schoolLevelLabel(levels[0])}</span>}
          <label><span className="sr-only">종별 {index + 1}</span><input value={division.name} maxLength={30} placeholder={`종별 ${index + 1}`} onChange={(event) => updateDivision(division.key, { name: event.target.value })} required /></label>
          <button type="button" className="sport-division-remove" disabled={busy || divisions.length === 1} onClick={() => removeDivision(division.key)} aria-label={`${division.name || `종별 ${index + 1}`} 삭제`}>×</button>
        </div>)}
      </div>
      <button type="button" className="sport-division-add" disabled={busy || divisions.length >= 8} onClick={addDivision}>+ 종별 추가</button>
    </fieldset>
    <footer>{onCancel && <button type="button" className="outline-button" disabled={busy} onClick={onCancel}>취소</button>}<button type="submit" className="solid-button" disabled={busy}>{busy ? "저장 중…" : isNew ? "+ 종목 추가" : "수정 내용 저장"}</button></footer>
  </form>;
}

function NewSurveyForm({ academicYear, start, end, busy, onCreate }: { academicYear: number; start: string; end: string; busy: boolean; onCreate: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  return <form onSubmit={onCreate}><fieldset className="school-level-fieldset"><legend>참가 대상 학교 <small>복수 선택 가능</small></legend><div className="school-level-options">{SCHOOL_LEVELS.map((level) => <label key={level.value}><input type="checkbox" name="schoolLevels" value={level.value} defaultChecked={level.value === "middle"} disabled={busy} /><span>{level.label}</span></label>)}</div><p>한 학교급 이상 선택해 주세요. 선택한 학교만 이 대회에 신청할 수 있습니다.</p></fieldset><div className="form-two"><label><span>학년도</span><input name="academicYear" type="number" min="2020" max="2100" defaultValue={academicYear} required /></label><label><span>대회명</span><input name="name" placeholder="예: 동부학교스포츠클럽 후반기 대회" required /></label></div><div className="form-two"><label><span>신청 시작 · 한국시간</span><input name="surveyStart" type="datetime-local" defaultValue={start} required /></label><label><span>신청 종료 · 한국시간</span><input name="surveyEnd" type="datetime-local" defaultValue={end} required /></label></div><button className="solid-button" disabled={busy}>+ 새 대회 추가</button></form>;
}

function AdminPanel({ dashboard, refresh }: { dashboard: Dashboard; refresh: (eventId?: string) => Promise<void> }) {
  const [tab, setTab] = useState<"results" | "event" | "sports" | "schools" | "account">("results");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<"all" | "sport" | null>(null);
  const [exportSportId, setExportSportId] = useState(dashboard.sports[0]?.id ?? "");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingSportId, setEditingSportId] = useState<string | null>(null);
  const [resultFilter, setResultFilter] = useState<"all" | "done" | "waiting">("all");
  const [resultQuery, setResultQuery] = useState("");
  const [resultLevel, setResultLevel] = useState<SchoolLevel | null>(null);
  const [selectedDivision, setSelectedDivision] = useState<{ eventId: string; sport: Sport; division: Division } | null>(null);
  const divisionModalRef = useRef<HTMLElement>(null);
  const divisionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = dashboard.selectedEvent;
  const selectedLevels = schoolLevels(selected?.schoolLevels) as SchoolLevel[];
  const mixedLevels = selectedLevels.length > 1;
  const [newSportVersion, setNewSportVersion] = useState(0);
  const selectedExportSportId = dashboard.sports.some((sport) => sport.id === exportSportId)
    ? exportSportId
    : dashboard.sports[0]?.id ?? "";
  const activeSelectedDivision = selectedDivision?.eventId === selected?.id ? selectedDivision : null;
  const responded = dashboard.rows.filter((row) => row.submitted);
  const noParticipation = responded.filter((row) => row.noParticipation);
  const participationRows = responded.filter((row) => !row.noParticipation);
  const visibleResultLevel = resultLevel && selectedLevels.includes(resultLevel) ? resultLevel : selectedLevels[0] ?? "middle";
  const levelRows = dashboard.rows.filter((row) => (row.school.schoolLevel ?? "middle") === visibleResultLevel);
  const levelResponded = levelRows.filter((row) => row.submitted);
  const filteredRows = levelRows.filter((row) => row.school.name.includes(resultQuery.trim()) && (resultFilter === "all" || (resultFilter === "done" ? row.submitted : !row.submitted)));
  const divisionColumns = dashboard.sports.flatMap((sport) => sport.divisions.filter((division) => (division.schoolLevel ?? "middle") === visibleResultLevel).map((division) => ({ sport, division })));
  const selectionCount = (row: ResultRow, divisionId: string) => {
    const storedCount = row.selections.find((item) => item.divisionId === divisionId)?.teamCount ?? 0;
    return storedCount > 0 ? storedCount : 0;
  };
  const sportMetrics = dashboard.sports.map((sport) => {
    const divisionMetrics = sport.divisions.map((division) => {
      const participants = participationRows
        .map((row) => ({ row, teamCount: selectionCount(row, division.id) }))
        .filter((participant) => participant.teamCount > 0);
      return {
        division,
        schoolCount: participants.length,
        teamCount: participants.reduce((total, participant) => total + participant.teamCount, 0),
      };
    });
    const schoolCount = participationRows.filter((row) => sport.divisions.some((division) => selectionCount(row, division.id) > 0)).length;
    const teamCount = divisionMetrics.reduce((total, division) => total + division.teamCount, 0);
    return { sport, schoolCount, teamCount, divisionMetrics };
  });
  const selectedDivisionParticipants = activeSelectedDivision
    ? participationRows
      .map((row) => ({ row, teamCount: selectionCount(row, activeSelectedDivision.division.id) }))
      .filter((participant) => participant.teamCount > 0)
    : [];
  const selectedDivisionTeamCount = selectedDivisionParticipants.reduce((total, participant) => total + participant.teamCount, 0);

  useEffect(() => {
    if (!activeSelectedDivision) return;
    const body = document.body;
    const root = document.documentElement;
    const scrollY = window.scrollY;
    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
    const previousBodyStyles = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      paddingRight: body.style.paddingRight,
    };
    const previousRootStyles = {
      overflow: root.style.overflow,
      overscrollBehavior: root.style.overscrollBehavior,
    };
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    if (scrollbarWidth) body.style.paddingRight = `${scrollbarWidth}px`;
    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";

    const focusFrame = window.requestAnimationFrame(() => {
      divisionModalRef.current?.querySelector<HTMLButtonElement>(".division-modal-close")?.focus();
    });
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedDivision(null);
        return;
      }
      if (event.key !== "Tab" || !divisionModalRef.current) return;
      const focusable = [...divisionModalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      body.style.overflow = previousBodyStyles.overflow;
      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.width = previousBodyStyles.width;
      body.style.paddingRight = previousBodyStyles.paddingRight;
      root.style.overflow = previousRootStyles.overflow;
      root.style.overscrollBehavior = previousRootStyles.overscrollBehavior;
      window.scrollTo(0, scrollY);
      divisionTriggerRef.current?.focus({ preventScroll: true });
    };
  }, [activeSelectedDivision]);

  function openDivisionParticipants(event: ReactMouseEvent<HTMLButtonElement>, sport: Sport, division: Division) {
    if (!selected) return;
    divisionTriggerRef.current = event.currentTarget;
    setSelectedDivision({ eventId: selected.id, sport, division });
  }

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(success); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "처리하지 못했습니다."); }
    finally { setBusy(false); }
  }

  async function logoutAdmin() {
    try { await api("admin/logout", { method: "POST", body: "{}" }); } finally { window.location.replace("/admin"); }
  }

  async function exportWorkbook(scope: "all" | "sport") {
    if (!selected || exporting) return;
    if (scope === "sport" && !selectedExportSportId) {
      setError("내보낼 종목을 먼저 선택해 주세요.");
      return;
    }
    setExporting(scope);
    setError("");
    setNotice("");
    try {
      const freshDashboard = await api<Dashboard>(`admin/dashboard?eventId=${encodeURIComponent(selected.id)}`);
      if (freshDashboard.selectedEvent?.id !== selected.id) {
        throw new Error("선택한 대회 결과를 확인하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.");
      }
      if (scope === "sport" && !freshDashboard.sports.some((sport) => sport.id === selectedExportSportId)) {
        throw new Error("선택한 종목을 현재 대회에서 찾을 수 없습니다. 종목을 다시 선택해 주세요.");
      }
      const { downloadSurveyWorkbook } = await import("./survey-workbook.js");
      await downloadSurveyWorkbook(freshDashboard, scope === "sport" ? { sportId: selectedExportSportId } : {});
      setNotice(scope === "all" ? "모든 종목의 최신 결과 엑셀 다운로드를 시작했습니다." : "선택한 종목의 최신 결과 엑셀 다운로드를 시작했습니다.");
    } catch (requestError) {
      if (requestError instanceof ApiRequestError && requestError.status === 401) {
        window.location.replace("/admin");
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "엑셀 파일을 만들지 못했습니다.");
    } finally {
      setExporting(null);
    }
  }

  function eventPayload(form: HTMLFormElement) {
    const data = new FormData(form);
    return {
      academicYear: Number(data.get("academicYear")),
      name: String(data.get("name") ?? ""),
      surveyStart: seoulInputToIso(String(data.get("surveyStart") ?? "")),
      surveyEnd: seoulInputToIso(String(data.get("surveyEnd") ?? "")),
    };
  }

  async function updateSelectedEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const payload = eventPayload(event.currentTarget);
    await run(async () => {
      await api(`admin/events/${encodeURIComponent(selected.id)}`, { method: "PATCH", body: JSON.stringify(payload) });
      await refresh(selected.id);
    }, "대회 정보를 저장했습니다.");
  }

  async function createNewEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const chosenLevels = new FormData(form).getAll("schoolLevels").map(String);
    if (!chosenLevels.length) { setError("참가 대상 학교급을 하나 이상 선택해 주세요."); setNotice(""); return; }
    const payload = { ...eventPayload(form), schoolLevels: chosenLevels };
    await run(async () => {
      const created = await api<{ id: string }>("admin/events", { method: "POST", body: JSON.stringify(payload) });
      await refresh(created.id);
      form.reset();
      setTab("sports");
    }, "종목이 없는 새 대회를 비공개로 추가했습니다. ‘종목 관리’에서 종목과 종별을 추가한 뒤 공개해 주세요. 기존 대회와 신청은 보존됩니다.");
  }

  async function activateSelected() {
    if (!selected) return;
    await run(async () => {
      await api(`admin/events/${encodeURIComponent(selected.id)}/activate`, { method: "POST", body: "{}" });
      await refresh(selected.id);
    }, "대회를 교사 화면에 공개했습니다. 기존에 공개한 대회는 그대로 유지되며, 교사가 대회 목록에서 선택할 수 있습니다.");
  }

  async function unpublishSelected() {
    if (!selected || !window.confirm("이 대회를 교사 화면에서 숨길까요? 기존 신청은 보존되며, 다시 공개할 수 있습니다.")) return;
    await run(async () => {
      await api(`admin/events/${encodeURIComponent(selected.id)}/unpublish`, { method: "POST", body: "{}" });
      await refresh(selected.id);
    }, "대회를 비공개로 전환했습니다. 기존 신청은 그대로 보존됩니다.");
  }

  async function saveHeaderCopy(copy: Record<string, string>) {
    if (!selected) return;
    await run(async () => {
      await api(`admin/events/${encodeURIComponent(selected.id)}/header-copy`, { method: "PATCH", body: JSON.stringify({ headerCopy: copy }) });
      await refresh(selected.id);
    }, "상단 로고·제목을 저장했습니다. 관리자 화면에 반영했으며, 공개된 대회는 교사 화면을 새로고침하면 반영됩니다.");
  }

  async function saveLogoImage(image: Blob | null) {
    if (!selected) throw new Error("대회를 먼저 선택해 주세요.");
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`admin/events/${encodeURIComponent(selected.id)}/logo`, image
        ? { method: "PUT", headers: { "Content-Type": "image/png" }, body: image }
        : { method: "DELETE" });
      try { await refresh(selected.id); }
      catch { throw new Error("로고 설정은 저장되었습니다. 최신 화면을 불러오려면 새로고침해 주세요."); }
    } finally { setBusy(false); }
  }

  async function saveCardCopy(copy: Record<string, string>) {
    if (!selected) return;
    await run(async () => {
      await api(`admin/events/${encodeURIComponent(selected.id)}/card-copy`, { method: "PATCH", body: JSON.stringify({ cardCopy: copy }) });
      await refresh(selected.id);
    }, "안내 카드 문구를 저장했습니다. 현재 대회인 경우 교사 화면에 바로 반영됩니다.");
  }

  async function addSport(payload: SportUpdatePayload) {
    if (!selected) return;
    await run(async () => {
      await api("admin/sports", { method: "POST", body: JSON.stringify({ eventId: selected.id, ...payload }) });
      await refresh(selected.id);
      setNewSportVersion((version) => version + 1);
    }, "새 종목을 추가했습니다.");
  }

  async function toggleSportActive(sport: Sport) {
    if (!selected) return;
    await run(async () => {
      await api(`admin/sports/${encodeURIComponent(sport.id)}/active`, { method: "PATCH", body: JSON.stringify({ active: !sport.active }) });
      await refresh(selected.id);
    }, sport.active ? "종목을 비활성화했습니다." : "종목을 다시 활성화했습니다.");
  }

  async function updateExistingSport(sportId: string, payload: SportUpdatePayload) {
    if (!selected) return;
    await run(async () => {
      await api(`admin/sports/${encodeURIComponent(sportId)}`, { method: "PATCH", body: JSON.stringify(payload) });
      await refresh(selected.id);
      setEditingSportId(null);
    }, "종목 세부사항을 저장했습니다.");
  }

  async function removeSport(sport: Sport) {
    if (!selected || !window.confirm(`'${sport.name}' 종목을 삭제할까요?\n\n저장된 신청 내역이 있는 종목은 삭제되지 않습니다.`)) return;
    await run(async () => {
      await api(`admin/sports/${encodeURIComponent(sport.id)}`, { method: "DELETE" });
      await refresh(selected.id);
      setEditingSportId(null);
    }, `'${sport.name}' 종목을 삭제했습니다.`);
  }

  const newStart = selected?.surveyEnd ? seoulInputValue(selected.surveyEnd) : "2026-09-07T09:00";
  const newEndDate = selected?.surveyEnd ? new Date(new Date(selected.surveyEnd).getTime() + 14 * 86400000).toISOString() : "2026-09-21T09:00:00.000Z";

  return <main className="admin-shell">
    <aside className="admin-sidebar"><Brand admin tournament={selected} /><nav><small>OVERVIEW</small><button type="button" className={tab === "results" ? "active" : ""} aria-current={tab === "results" ? "page" : undefined} onClick={() => setTab("results")}><span>≡</span>결과 종합</button><small>MANAGEMENT</small><button type="button" className={tab === "event" ? "active" : ""} aria-current={tab === "event" ? "page" : undefined} onClick={() => setTab("event")}><span>▣</span>대회·기간 설정</button><button type="button" className={tab === "sports" ? "active" : ""} aria-current={tab === "sports" ? "page" : undefined} onClick={() => setTab("sports")}><span>◉</span>종목 관리</button><button type="button" className={tab === "schools" ? "active" : ""} aria-current={tab === "schools" ? "page" : undefined} onClick={() => setTab("schools")}><span>▤</span>학교 관리</button><button type="button" className={tab === "account" ? "active" : ""} aria-current={tab === "account" ? "page" : undefined} onClick={() => setTab("account")}><span>⚙</span>계정 설정</button></nav><div className="admin-side-foot"><span>{dashboard.adminUsername.slice(0, 1).toUpperCase()}</span><p><b>{dashboard.adminUsername}</b><small>참가 신청 설정·집계</small></p><button type="button" onClick={() => void logoutAdmin()} aria-label="관리자 로그아웃">↗</button></div></aside>
    <section className="admin-main">
      <header className="admin-topbar"><div><p>ADMIN CONSOLE</p><h1>{tab === "results" ? "참가 신청 결과 종합" : tab === "event" ? "대회·신청 기간 설정" : tab === "sports" ? "종목 관리" : tab === "schools" ? "학교·기관번호 관리" : "관리자 계정 설정"}</h1></div><div>{tab !== "account" && tab !== "schools" && <label><span>조회 대회</span><select value={selected?.id ?? ""} disabled={busy || exporting !== null} onChange={(event) => { const eventId = event.target.value; setSelectedDivision(null); void run(() => refresh(eventId), ""); }}>{dashboard.events.map((tournament) => <option value={tournament.id} key={tournament.id}>{tournament.academicYear} · {tournament.name}{tournament.status === "active" ? " (공개)" : ""}</option>)}</select></label>}<a href="/" target="_blank" rel="noreferrer">교사 화면 ↗</a><button type="button" className="admin-topbar-logout" onClick={() => void logoutAdmin()}>로그아웃</button></div></header>
      {error && <div className="admin-flash error" role="alert"><SentenceFlow text={error} /></div>}
      {notice && <div className="admin-flash success" role="status"><SentenceFlow text={notice} /></div>}
      {tab === "account" ? <AdminAccountSettings currentUsername={dashboard.adminUsername} /> : tab === "schools" ? <AdminSchoolManagement onAdded={() => refresh(selected?.id)} /> : !selected ? <section className="admin-empty"><b>등록된 대회가 없습니다.</b><button type="button" onClick={() => setTab("event")}>+ 첫 대회 추가</button></section> : tab === "results" ? <>
        <section className="dashboard-title"><div><p>{selected.academicYear} SCHOOL SPORTS</p><h2 title={selected.name}>{selected.name}</h2><small className="dashboard-meta"><span className="dashboard-meta-group">{schoolLevelsLabel(selected.schoolLevels)}</span><span className="dashboard-meta-group"><span>{formatDate(selected.surveyStart)}</span><i aria-hidden="true">~</i><span>{formatDate(selected.surveyEnd)}</span></span><span className="dashboard-meta-group"><i aria-hidden="true">·</i><span>{dashboard.surveyState?.message}</span></span></small></div><span className={`status-chip ${dashboard.surveyState?.open ? "open" : "closed"}`}>{dashboard.surveyState?.open ? "진행 중" : "신청 기간 아님"}</span></section>
        <section className="metric-grid"><article><span>전체 대상 학교</span><b>{dashboard.rows.length}<small>개교</small></b></article><article><span>신청 완료</span><b>{responded.length}<small>개교</small></b><i style={{ width: `${dashboard.rows.length ? (responded.length / dashboard.rows.length) * 100 : 0}%` }} /></article><article><span>미신청</span><b>{dashboard.rows.length - responded.length}<small>개교</small></b></article><article><span>참가 신청 없음</span><b>{noParticipation.length}<small>개교</small></b></article></section>
        <section className="sport-metrics" aria-label="종목과 종별 참가 현황">{sportMetrics.map(({ sport, schoolCount, teamCount, divisionMetrics }) => <article className={sport.active ? "" : "inactive"} key={sport.id}>
          <header className="sport-metric-head"><div className="sport-metric-identity"><SportSymbol sport={sport} /><div className="sport-metric-title"><span title={sport.name}>{sport.name}</span>{!sport.active && <small>비활성 종목</small>}</div></div><div className="sport-metric-totals"><p><b>{schoolCount}</b><small>참가 학교</small></p><p><b>{teamCount}</b><small>신청 팀</small></p></div></header>
          <div className="sport-division-metrics" aria-label={`${sport.name} 종별 집계`}>{divisionMetrics.map(({ division, schoolCount: divisionSchoolCount, teamCount: divisionTeamCount }) => <button type="button" className={division.active ? "" : "inactive"} key={division.id} aria-haspopup="dialog" aria-controls="division-participants-dialog" aria-label={`${sport.name} ${division.name}, ${divisionTeamCount}팀, ${divisionSchoolCount}개교 참가 학교 보기`} onClick={(event) => openDivisionParticipants(event, sport, division)}><span className="sport-division-name"><span title={division.name}>{division.name}</span>{!division.active && <small>비활성</small>}</span><b>{divisionTeamCount}<small>팀</small></b><em><span>{divisionSchoolCount}개교</span><span>학교 보기</span><i aria-hidden="true">→</i></em></button>)}</div>
        </article>)}</section>
        <section className="export-panel" aria-labelledby="excel-export-title">
          <div className="export-copy"><span aria-hidden="true">XL</span><div><p>EXCEL REPORT</p><h2 id="excel-export-title">참가 신청 결과 내보내기</h2><small>다운로드 시점의 최신 신청 내역을 반영한 운영자용 엑셀 파일을 만듭니다.</small></div></div>
          <div className="export-controls">
            <label><span>종목별 내보내기</span><select value={selectedExportSportId} disabled={!dashboard.sports.length || exporting !== null} onChange={(event) => setExportSportId(event.target.value)}>{dashboard.sports.map((sport) => <option value={sport.id} key={sport.id}>{sport.name}{sport.active ? "" : " (비활성)"}</option>)}</select></label>
            <button type="button" className="export-sport-button" disabled={!selectedExportSportId || exporting !== null} onClick={() => void exportWorkbook("sport")}>{exporting === "sport" ? "종목 파일 만드는 중…" : "선택 종목 내보내기"}</button>
            <button type="button" className="export-all-button" disabled={exporting !== null} onClick={() => void exportWorkbook("all")}>{exporting === "all" ? "전체 파일 만드는 중…" : "모두 내보내기"}<span aria-hidden="true">↓</span></button>
          </div>
        </section>
        <section className="results-panel"><header><div><p>ALL SCHOOLS</p><h2>학교별 신청 현황</h2></div><span>{schoolLevelLabel(visibleResultLevel)} · {levelResponded.length} / {levelRows.length}개교 신청</span></header><div className="results-school-tabs" role="tablist" aria-label="학교별 신청 현황 학교급">{SCHOOL_LEVELS.map((level) => <button type="button" key={level.value} role="tab" id={`response-tab-${level.value}`} aria-controls="response-level-panel" aria-selected={visibleResultLevel === level.value} tabIndex={visibleResultLevel === level.value ? 0 : -1} disabled={!selectedLevels.includes(level.value as SchoolLevel)} onClick={() => { setResultLevel(level.value as SchoolLevel); setResultFilter("all"); }} onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const next = event.key === "Home" ? selectedLevels[0] : event.key === "End" ? selectedLevels[selectedLevels.length - 1] : selectedLevels.find((value) => value !== visibleResultLevel) ?? visibleResultLevel; setResultLevel(next); setResultFilter("all"); document.getElementById(`response-tab-${next}`)?.focus(); }}>{level.value === "elementary" ? "초등" : "중등"}<b>{dashboard.rows.filter((row) => (row.school.schoolLevel ?? "middle") === level.value).length}개교</b></button>)}</div><div role="tabpanel" id="response-level-panel" aria-labelledby={`response-tab-${visibleResultLevel}`}><div className="results-filter-bar"><div className="result-tabs" role="group" aria-label="신청 상태 필터">{([{ value: "all", label: "전체", count: levelRows.length }, { value: "done", label: "신청 완료", count: levelResponded.length }, { value: "waiting", label: "미신청", count: levelRows.length - levelResponded.length }] as const).map((item) => <button type="button" key={item.value} aria-pressed={resultFilter === item.value} onClick={() => setResultFilter(item.value)}>{item.label} {item.count}</button>)}</div><input type="search" aria-label="결과 학교명 검색" placeholder="학교명 검색" value={resultQuery} onChange={(event) => setResultQuery(event.target.value)} /></div><div className="results-table-wrap"><table><caption className="sr-only">{selected.name} {schoolLevelLabel(visibleResultLevel)} 신청 현황</caption><thead><tr><th scope="col">#</th><th scope="col">학교명</th><th scope="col">신청 상태</th>{divisionColumns.map(({ sport, division }) => <th scope="col" key={division.id}><small>{sport.name}</small>{division.name}</th>)}<th scope="col">마지막 저장</th></tr></thead><tbody>{filteredRows.map((row) => <tr key={row.school.id}><td>{row.school.displayOrder}</td><td><b title={row.school.name}>{row.school.name}</b>{mixedLevels && <small className="result-school-level">{schoolLevelLabel(row.school.schoolLevel)}</small>}</td><td><span className={`response-status ${!row.submitted ? "waiting" : row.noParticipation ? "none" : "done"}`}>{!row.submitted ? "미신청" : row.noParticipation ? "참가 신청 없음" : "신청 완료"}</span></td>{divisionColumns.map(({ division }) => { const count = selectionCount(row, division.id); return <td key={division.id}>{count ? <b>{count}팀</b> : <span className="dash">-</span>}</td>; })}<td>{formatDate(row.updatedAt)}</td></tr>)}{!filteredRows.length && <tr><td colSpan={divisionColumns.length + 4}>조건에 맞는 학교가 없습니다.</td></tr>}</tbody></table></div></div></section>
      </> : tab === "event" ? <section className="admin-settings-grid">
        <article className="settings-card"><header><span>01</span><div><p>CURRENT EVENT</p><h2>대회 정보·신청 기간</h2></div></header><form key={selected.id} onSubmit={updateSelectedEvent}><div className="form-two"><label><span>학년도</span><input name="academicYear" type="number" min="2020" max="2100" defaultValue={selected.academicYear} required /></label><label><span>대회 상태</span><input value={selected.status === "active" ? "교사 화면에 공개 중" : "임시저장 · 비공개"} disabled /></label></div><label><span>대회명</span><input name="name" defaultValue={selected.name} required /></label><div className="survey-target-summary"><span>참가 대상</span><div>{selectedLevels.map((level) => <span className="school-level-chip" key={level}>{schoolLevelLabel(level)}</span>)}</div><small>기존 신청을 보호하기 위해 참가 대상은 변경되지 않습니다. 다른 대상의 대회는 ‘새 대회 추가’에서 만들어 주세요.</small></div><div className="form-two"><label><span>신청 시작 · 한국시간</span><input name="surveyStart" type="datetime-local" defaultValue={seoulInputValue(selected.surveyStart)} required /></label><label><span>신청 종료 · 한국시간</span><input name="surveyEnd" type="datetime-local" defaultValue={seoulInputValue(selected.surveyEnd)} required /></label></div><p className="publication-help">여러 대회를 동시에 공개할 수 있습니다. 신청 기간이 겹치면 교사가 목록에서 선택해 신청합니다.</p><footer className="survey-publication-actions">{selected.status === "active" ? <button type="button" className="outline-button" disabled={busy} onClick={() => void unpublishSelected()}>비공개로 전환</button> : <button type="button" className="outline-button" disabled={busy} onClick={() => void activateSelected()}>교사 화면에 공개</button>}<button className="solid-button" disabled={busy}>변경 사항 저장</button></footer></form></article>
        <article className="settings-card new-event-card"><header><span>02</span><div><p>NEW EVENT</p><h2>새 대회 추가</h2></div></header><p className="prose-copy"><span className="sentence-unit">기존 대회와 신청을 보존하면서 별도의 대회를 추가합니다.</span>{" "}<span className="sentence-unit">새 대회는 비공개로 생성되며, 종목과 종별은 빈 상태로 시작합니다. ‘종목 관리’에서 필요한 종목을 직접 추가해 주세요.</span></p><NewSurveyForm academicYear={selected.academicYear + 1} start={newStart} end={seoulInputValue(newEndDate)} busy={busy} onCreate={createNewEvent} /></article>
        <PageHeaderEditor key={`header-${selected.id}-${selected.headerCopy}`} tournament={selected} busy={busy} onSave={saveHeaderCopy} onSaveLogo={saveLogoImage} />
        <EventCardEditor key={`card-${selected.id}-${selected.cardCopy}-${selected.academicYear}-${selected.name}`} tournament={selected} sports={dashboard.sports} schoolCount={dashboard.rows.length} busy={busy} onSave={saveCardCopy} />
      </section> : <section className="admin-settings-grid sports-management">
        <article className="settings-card"><header><span>01</span><div><p>SPORTS LIST</p><h2 title={selected.name}>{selected.name} 종목</h2></div></header><p className="prose-copy"><span className="sentence-unit">종목 그림·종별·팀 수 기준을 수정할 수 있습니다.</span>{" "}<span className="sentence-unit">신청 기록이 있는 종목은 삭제할 수 없으며 신청 기간 중에는 비활성화도 제한됩니다.</span></p><div className="managed-sports">{dashboard.sports.map((sport) => <section className={`managed-sport-card${sport.active ? "" : " inactive"}`} key={sport.id} aria-labelledby={`sport-name-${sport.id}`}>
          <div className="managed-sport-summary"><SportSymbol sport={sport} className="managed-sport-icon" /><div className="managed-sport-copy"><span><b id={`sport-name-${sport.id}`} title={sport.name}>{sport.name}</b><i className={sport.active ? "active" : "inactive"}>{sport.active ? "활성" : "비활성"}</i></span><small title={`${sport.divisions.map((division) => division.name).join(" · ")} · ${teamLimitLabel(sport)}`}>{sport.divisions.map((division) => division.name).join(" · ")} · 학교 전체 최대 <span className="number-unit">{sport.maxTeamsPerSchool}팀</span> · 한 종별 최대 <span className="number-unit">{sport.maxTeamsPerDivision}팀</span></small></div><div className="managed-sport-actions"><button type="button" disabled={busy} aria-expanded={editingSportId === sport.id} aria-controls={`sport-editor-${sport.id}`} aria-label={`${sport.name} 수정`} onClick={() => setEditingSportId((current) => current === sport.id ? null : sport.id)}>{editingSportId === sport.id ? "닫기" : "수정"}</button><button type="button" disabled={busy} aria-label={`${sport.name} ${sport.active ? "비활성화" : "활성화"}`} onClick={() => void toggleSportActive(sport)}>{sport.active ? "비활성화" : "활성화"}</button><button type="button" className="delete" disabled={busy} aria-label={`${sport.name} 삭제`} onClick={() => void removeSport(sport)}>삭제</button></div></div>
          {editingSportId === sport.id && <div id={`sport-editor-${sport.id}`}><SportEditor key={`${sport.id}-${sport.divisions.map((division) => division.id).join("-")}`} sport={sport} levels={selectedLevels} busy={busy} onSave={(payload) => updateExistingSport(sport.id, payload)} onCancel={() => setEditingSportId(null)} /></div>}
        </section>)}{!dashboard.sports.length && <div className="sports-empty-state"><SportSymbol sport={{ name: "", iconKey: "generic" }} /><h3>아직 등록된 종목이 없습니다.</h3><p>새 대회는 종목 없이 시작합니다. 필요한 종목과 종별을 직접 추가해 주세요.</p><a className="outline-button" href="#new-sport-editor" onClick={(event) => { event.preventDefault(); document.getElementById("new-sport-editor")?.querySelector<HTMLInputElement>("input")?.focus(); }}>+ 첫 종목 추가하기</a></div>}</div></article>
        <article className="settings-card" id="new-sport-editor"><header><span>02</span><div><p>ADD SPORT</p><h2>새 종목 추가</h2></div></header><SportEditor key={`new-sport-${selected.id}-${newSportVersion}`} sport={{ id: "new-sport", name: "", displayOrder: 0, teamCountEnabled: false, maxTeamsPerSchool: 2, maxTeamsPerDivision: 1, active: true, divisions: [] }} levels={selectedLevels} isNew busy={busy} onSave={addSport} /></article>
      </section>}
    </section>
    {activeSelectedDivision && <div className="division-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedDivision(null); }}>
      <section id="division-participants-dialog" className="division-participants-modal" ref={divisionModalRef} role="dialog" aria-modal="true" aria-labelledby="division-modal-title" aria-describedby="division-modal-description">
        <header><div><p>DIVISION PARTICIPANTS</p><h2 id="division-modal-title"><span className="division-modal-sport" title={activeSelectedDivision.sport.name}>{activeSelectedDivision.sport.name}</span><span className="division-modal-name" title={activeSelectedDivision.division.name}>· {activeSelectedDivision.division.name}</span></h2><small id="division-modal-description" title={selected?.name}>{selected?.name} 참가 신청 학교</small></div><button type="button" className="division-modal-close" aria-label="참가 학교 모달 닫기" onClick={() => setSelectedDivision(null)}>×</button></header>
        <div className="division-modal-summary"><p><span>참가 학교</span><b>{selectedDivisionParticipants.length}<small>개교</small></b></p><p><span>신청 팀</span><b>{selectedDivisionTeamCount}<small>팀</small></b></p></div>
        <div className="division-participant-list">{selectedDivisionParticipants.length ? <ol>{selectedDivisionParticipants.map(({ row, teamCount }) => <li key={row.school.id}><span>{row.school.displayOrder}</span><p><b title={row.school.name}>{row.school.name}</b><small>{mixedLevels ? `${schoolLevelLabel(row.school.schoolLevel)} · ` : ""}학교 순번 {row.school.displayOrder}</small></p><strong>{teamCount}<small>팀</small></strong></li>)}</ol> : <div className="division-participant-empty"><span>–</span><b>아직 참가 신청한 학교가 없습니다.</b><small>해당 종별에 저장된 신청 팀이 없습니다.</small></div>}</div>
        <footer><small>학교는 로그인 페이지에 등록된 순서로 표시됩니다.</small><button type="button" onClick={() => setSelectedDivision(null)}>확인</button></footer>
      </section>
    </div>}
  </main>;
}
