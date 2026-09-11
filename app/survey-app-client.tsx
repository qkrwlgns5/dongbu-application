"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- vinext internal links need a full document navigation in this deployment. */

import { FormEvent, Fragment, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { EVENT_CARD_FIELDS, eventCardCopy, formatEventCardDate } from "./event-card-copy.js";
import { PAGE_HEADER_FIELDS, pageHeaderCopy } from "./page-header-copy.js";

type Tournament = {
  id: string;
  academicYear: number;
  name: string;
  surveyStart: string;
  cardCopy: string;
  headerCopy: string;
  surveyEnd: string;
  status: "draft" | "active" | "archived";
};

type Division = { id: string; name: string; displayOrder: number; active: boolean };
type Sport = {
  id: string;
  name: string;
  displayOrder: number;
  teamCountEnabled: boolean;
  maxTeamsPerSchool: number;
  maxTeamsPerDivision: number;
  active: boolean;
  divisions: Division[];
};

type School = { id: string; name: string; displayOrder: number };
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
};

type SchoolSession = {
  school: Pick<School, "id" | "name">;
  tournament: Tournament;
  sports: Sport[];
  survey: Survey;
};

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
  events: Tournament[];
  selectedEvent: Tournament | null;
  surveyState?: { open: boolean; code: string; message: string };
  sports: Sport[];
  rows: ResultRow[];
};

type SportUpdatePayload = {
  name: string;
  divisions: Array<{ id?: string; name: string }>;
  maxTeamsPerSchool: number;
  maxTeamsPerDivision: number;
};

type DivisionDraft = { key: string; id?: string; name: string };

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

function Brand({ admin = false, tournament, copy, preview = false }: { admin?: boolean; tournament?: Tournament | null; copy?: Record<string, string>; preview?: boolean }) {
  const content = pageHeaderCopy(tournament, copy);
  const Container = preview ? "div" : "a";
  return (
    <Container className="brand" href={preview ? undefined : admin ? "/admin" : "/"} aria-label={preview ? undefined : "참가 신청 처음으로"}>
      <span className="brand-mark" data-length={[...content.logoText.normalize("NFC")].length} aria-hidden="true">{content.logoText}</span>
      <span><SentenceFlow text={content.brandName} />{(admin || content.brandSubtitle) && <b><SentenceFlow text={admin ? "참가 신청 관리" : content.brandSubtitle} /></b>}</span>
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
  return <main className="center-state"><span className="loading-ring" /><b><SentenceFlow text={message} /></b><small>잠시만 기다려 주세요.</small></main>;
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
  return <aside className="event-card" aria-label="대회 참가 안내">
    <div className="event-card-kicker">{content.eyebrow && <span>{content.eyebrow}</span>}{content.badge && <span>{content.badge}</span>}</div>
    <div className="event-card-titles">{content.title && <h2><CardText text={content.title} /></h2>}{content.subtitle && <h3><CardText text={content.subtitle} /></h3>}{content.description && <p><CardText text={content.description} /></p>}</div>
    <div className="event-card-details">{tournament && <div><UiIcon name="calendar" /><span>신청 기간</span><b><span>{formatEventCardDate(tournament.surveyStart)}</span><span>~ {formatEventCardDate(tournament.surveyEnd)}</span></b></div>}{content.target && <div><UiIcon name="school" /><span>참가 대상</span><b><SentenceFlow text={content.target} /></b></div>}</div>
    <div className="event-card-sports">{sports.filter((sport) => sport.active).map((sport) => <span key={sport.id}>{sport.name}</span>)}</div>
    <div className="event-card-bottom">{content.footer && <span><UiIcon name="check" /><SentenceFlow text={content.footer} /></span>}<b>{schoolCount}<small>개교</small></b></div>
  </aside>;
}

function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return <main className="center-state error-state"><span>!</span><b>페이지를 열지 못했습니다.</b><small><SentenceFlow text={message} /></small><button onClick={retry}>다시 시도</button></main>;
}

export function SurveyApp({ initialView = "school" }: { initialView?: "school" | "admin" }) {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [schoolSession, setSchoolSession] = useState<SchoolSession | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [phase, setPhase] = useState<"loading" | "login" | "survey" | "admin-login" | "admin">("loading");
  const [fatalError, setFatalError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setFatalError("");
      setPhase("loading");
      try {
        const boot = await api<Bootstrap>("bootstrap");
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
          const session = await api<SchoolSession>("school/session");
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

  if (fatalError) return <ErrorState message={fatalError} retry={() => setReloadKey((value) => value + 1)} />;
  if (phase === "loading" || !bootstrap) return <PageLoader />;
  if (phase === "login") return <SchoolLogin bootstrap={bootstrap} onLogin={(session) => { setSchoolSession(session); setPhase("survey"); }} />;
  if (phase === "survey" && schoolSession) return <SurveyForm session={schoolSession} />;
  if (phase === "admin-login") return <AdminLogin onLogin={async () => { await refreshDashboard(); setPhase("admin"); }} />;
  if (phase === "admin" && dashboard) return <AdminPanel dashboard={dashboard} refresh={refreshDashboard} />;
  return <PageLoader />;
}

function SchoolLogin({ bootstrap, onLogin }: { bootstrap: Bootstrap; onLogin: (session: SchoolSession) => void }) {
  const [selectedSchool, setSelectedSchool] = useState("");
  const [query, setQuery] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const filteredSchools = useMemo(
    () => bootstrap.schools.filter((school) => school.name.includes(query.trim())).sort((a, b) => a.displayOrder - b.displayOrder),
    [bootstrap.schools, query],
  );
  const selectedName = bootstrap.schools.find((school) => school.id === selectedSchool)?.name;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedSchool || !password || !bootstrap.surveyState.open) return;
    setBusy(true);
    setError("");
    try {
      const session = await api<SchoolSession>("school/login", {
        method: "POST",
        body: JSON.stringify({ schoolId: selectedSchool, password }),
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
        <div className="login-layout"><EventCard tournament={bootstrap.tournament} sports={bootstrap.sports} schoolCount={bootstrap.schools.length} />
          <section className="login-card school-login-card" aria-labelledby="login-title">
            <div className="school-selection-heading"><div><h2 id="login-title"><UiIcon name="school" />우리 학교 선택</h2><p>학교를 선택한 뒤 기관번호로 로그인해 주세요.</p></div><span>전체 <b>{bootstrap.schools.length}</b>개교</span></div>
            <form className="login-form" onSubmit={submit} aria-busy={busy}>
              <label className="school-search"><span className="sr-only">학교명 검색</span><UiIcon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="학교명으로 빠르게 찾기" /></label>
              <div className="school-picker" role="radiogroup" aria-label="학교 선택">
                {filteredSchools.map((school) => <button key={school.id} type="button" role="radio" aria-checked={selectedSchool === school.id} disabled={busy} className={selectedSchool === school.id ? "selected" : ""} title={school.name} onClick={() => { setSelectedSchool(school.id); setError(""); }}><span className="school-order">{String(school.displayOrder).padStart(2, "0")}</span><span className="school-name">{school.name}</span><i aria-hidden="true">✓</i></button>)}
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
        setError(`${sport.name} ${division.name}는 한 종별에서 최대 ${sport.maxTeamsPerDivision}팀까지 신청할 수 있습니다.`);
        return current;
      }
      const next = { ...current, [division.id]: count };
      if (totalForSport(sport, next) > sport.maxTeamsPerSchool) {
        setError(`${sport.name}는 모든 종별을 합쳐 학교 전체 최대 ${sport.maxTeamsPerSchool}팀까지 신청할 수 있습니다.`);
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
          setError(`${sport.name}는 모든 종별을 합쳐 학교 전체 최대 ${sport.maxTeamsPerSchool}팀까지 신청할 수 있습니다.`);
          return;
        }
      }
    }
    setBusy(true);
    try {
      const saved = await api<{ ok: true; survey: Survey }>("school/survey", {
        method: "PUT",
        body: JSON.stringify({
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

  async function leave() {
    try { await api("school/logout", { method: "POST", body: "{}" }); } finally { window.location.replace("/"); }
  }

  return (
    <main className="survey-shell">
      <header className="survey-topbar"><Brand /><div className="survey-account"><span>{session.school.name.slice(0, 1)}</span><p><b title={session.school.name}>{session.school.name}</b><small>학교 참가 신청</small></p><button type="button" onClick={() => void leave()}>로그아웃</button></div></header>
      <form className="survey-content" onSubmit={save}>
        <section className="application-heading"><div><span className="academic-year-badge">{session.tournament.academicYear}학년도</span><h1><small>{session.school.name}</small>우리 학교 참가 신청</h1><p><SentenceFlow text={session.tournament.name} /></p></div><ApplicationSteps current={2} /></section>
        <div className="application-period"><UiIcon name="calendar" /><b>참가 신청 기간</b><span className="period-date">{formatDate(session.tournament.surveyStart)}</span><span className="period-date">— {formatDate(session.tournament.surveyEnd)}</span><small>한국시간</small></div>
        {session.survey.submitted && <div className="prefill-banner"><span>✓</span><p><b>기존 신청 내용을 불러왔습니다.</b><small className="prefill-meta"><span>마지막 저장 {formatDate(session.survey.updatedAt)}</span><span>· 변경 후 다시 저장해 주세요.</span></small></p></div>}

        <div className="application-layout"><div className="application-main">
        <div className="intent-control"><span>이번 대회 참가 여부</span><div className="intent-options" role="group" aria-label="참가 여부"><button type="button" aria-pressed={!noParticipation} disabled={busy} onClick={() => { setNoParticipation(false); setError(""); }}>참가합니다</button><button type="button" aria-pressed={noParticipation} disabled={busy} onClick={chooseNoParticipation}>참가하지 않습니다</button></div></div>
        {noParticipation ? <section className="application-none"><UiIcon name="school" /><h2>이번 대회는 참가하지 않습니다.</h2><p>‘참가 신청 저장’을 누르면<br />우리 학교가 신청 완료로 집계됩니다.</p></section> : <section className="sports-grid">
          {session.sports.map((sport, index) => {
            const enabled = enabledSports.includes(sport.id);
            const total = totalForSport(sport);
            return <article className={`sport-card ${enabled ? "enabled" : ""}`} key={sport.id}>
              <header><span className={`sport-symbol sport-symbol-${index % 3}`} aria-hidden="true">{sport.name === "배구" ? "VB" : /3[x×]3/.test(sport.name) ? "3×3" : sport.name === "피구" ? "DB" : sport.name.slice(0, 2)}</span><div><h2 title={sport.name}>{sport.name}</h2><small>{sport.name === "배구" ? "VOLLEYBALL" : /3[x×]3/.test(sport.name) ? "BASKETBALL" : sport.name === "피구" ? "DODGEBALL" : `SPORT ${String(index + 1).padStart(2, "0")}`}</small></div><button type="button" role="switch" aria-label={`${sport.name} 참가`} aria-checked={enabled} onClick={() => toggleSport(sport)} disabled={busy}><i /><b>{enabled ? "참가" : "미선택"}</b></button></header>
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
            </article>;
          })}
        </section>}
        </div><aside className="application-summary" aria-label="신청 내용 요약"><header><small>APPLICATION SUMMARY</small><h2>우리 학교 신청 내역</h2><p>선택한 내용을 한 번 더 확인해 주세요.</p></header><div className="application-summary-body"><div className="summary-school"><UiIcon name="school" />{session.school.name}</div><div className="summary-selections" aria-live="polite">{!noParticipation && session.sports.filter((sport) => totalForSport(sport) > 0).map((sport) => <div key={sport.id}><b>{sport.name}</b><p>{sport.divisions.filter((division) => selections[division.id]).map((division) => <span key={division.id}>{division.name} <b>{selections[division.id]}팀</b></span>)}</p></div>)}{(noParticipation || !Object.keys(selections).length) && <p className="summary-empty">{noParticipation ? "이번 대회 참가 신청 없음" : "참가할 종별을 선택해 주세요."}</p>}</div><div className="summary-total"><span>{noParticipation ? "참가 신청 없음" : "총 신청 팀"}</span><b>{noParticipation ? 0 : Object.values(selections).reduce((sum, count) => sum + count, 0)}<small>팀</small></b></div>{error && <p className="survey-error summary-error" role="alert"><span className="survey-error-message"><SentenceFlow text={error} /></span></p>}<button className="save-button" disabled={busy}>{busy ? "저장 중…" : session.survey.submitted ? "변경 내용 저장" : "참가 신청 저장"}<UiIcon name="check" /></button><p className="summary-note">신청 기간 안에는 다시 로그인해<br />수정할 수 있어요.</p></div></aside></div>
      </form>
      {success && <SaveConfirmation school={session.school.name} tournament={session.tournament.name} onConfirm={leave} />}
    </main>
  );
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

function PageHeaderEditor({ tournament, busy, onSave }: { tournament: Tournament; busy: boolean; onSave: (copy: Record<string, string>) => Promise<void> }) {
  const [copy, setCopy] = useState<Record<string, string>>(() => pageHeaderCopy(tournament));
  return <article className="settings-card page-header-editor">
    <header><span>03</span><div><p>LOGIN PAGE HEADER</p><h2>메인페이지 상단 로고·제목</h2></div></header>
    <p><SentenceFlow text="메인페이지 맨 위의 로고와 기관명, 학년도 배지 옆 문구, 두 줄 제목을 수정합니다. 선택한 대회에만 저장됩니다." /></p>
    <form onSubmit={(event) => { event.preventDefault(); void onSave(copy); }} aria-busy={busy}>
      <div className="card-editor-fields">{PAGE_HEADER_FIELDS.map((field) => <label key={field.key}>
        <span>{field.label}{field.required && " · 필수"}</span>
        {field.multiline
          ? <textarea value={copy[field.key] ?? ""} maxLength={field.max} rows={2} required={field.required} disabled={busy} onChange={(event) => setCopy((current) => ({ ...current, [field.key]: event.target.value }))} />
          : <input value={copy[field.key] ?? ""} maxLength={field.max} required={field.required} disabled={busy} onChange={(event) => setCopy((current) => ({ ...current, [field.key]: event.target.value }))} />}
        <small>{field.key === "logoText" ? "한글·영문·숫자 1~3자 · 공백 없이" : `${field.max}자 이내${field.required ? "" : " · 비워 두면 숨김"}`}</small>
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

function AdminLogin({ onLogin }: { onLogin: () => Promise<void> }) {
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
  return <main className="site-shell admin-login-shell"><header className="brand-bar"><Brand admin /><a className="admin-link" href="/">교사용 페이지</a></header><section className="admin-login-stage"><div><p className="eyebrow"><span /> ADMINISTRATION</p><h1 className="admin-login-title"><span>참가 신청을</span><span>한눈에 관리하세요.</span></h1><p className="admin-login-copy">대회·신청 기간·종목을 설정하고 42개교의 신청 현황을 실시간으로 확인합니다.</p></div><section className="login-card admin-login-card"><div className="card-accent" /><div className="card-heading"><span className="step-badge">A</span><div><p>SECURE ACCESS</p><h2>관리자 로그인</h2></div></div>{notice && <p className="login-status" role="status">✓ <SentenceFlow text={notice} /></p>}<form className="login-form" onSubmit={submit}><label><span>관리자 아이디</span><input name="username" autoComplete="username" required /></label><label><span>비밀번호</span><input name="password" type="password" autoComplete="current-password" required /></label>{error && <p className="form-error" role="alert"><SentenceFlow text={error} /></p>}<button className="primary-action" disabled={busy}>{busy ? "확인 중…" : "관리자 화면 열기"}<span>→</span></button></form><div className="security-note"><span>✓</span><p><b>관리자 전용</b><small>모든 관리 기능은 서버에서 권한을 다시 확인합니다.</small></p></div></section></section></main>;
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

function SportEditor({ sport, busy, onSave, onCancel }: {
  sport: Sport;
  busy: boolean;
  onSave: (payload: SportUpdatePayload) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(sport.name);
  const [maxTeamsPerSchool, setMaxTeamsPerSchool] = useState(sport.maxTeamsPerSchool);
  const [maxTeamsPerDivision, setMaxTeamsPerDivision] = useState(sport.maxTeamsPerDivision);
  const [divisions, setDivisions] = useState<DivisionDraft[]>(() => {
    const existing = sport.divisions.map((division) => ({ key: division.id, id: division.id, name: division.name }));
    return existing.length ? existing : [{ key: "new-initial", name: "" }];
  });

  function updateDivision(key: string, value: string) {
    setDivisions((current) => current.map((division) => division.key === key ? { ...division, name: value } : division));
  }

  function addDivision() {
    setDivisions((current) => current.length >= 8
      ? current
      : [...current, { key: `new-${Date.now()}-${current.length}`, name: "" }]);
  }

  function removeDivision(key: string) {
    setDivisions((current) => current.length === 1 ? current : current.filter((division) => division.key !== key));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSave({
      name,
      divisions: divisions.map((division) => ({ id: division.id, name: division.name })),
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
    <p className="team-limit-rule-note"><b>학교 전체</b>는 모든 종별의 합계이고, <b>한 종별</b>은 남중부 또는 여중부 각각의 한도입니다.</p>
    <fieldset className="sport-divisions">
      <legend>종별</legend>
      <div className="sport-division-list">
        {divisions.map((division, index) => <div className="sport-division-row" key={division.key}>
          <label><span className="sr-only">종별 {index + 1}</span><input value={division.name} maxLength={30} placeholder={`종별 ${index + 1}`} onChange={(event) => updateDivision(division.key, event.target.value)} required /></label>
          <button type="button" className="sport-division-remove" disabled={busy || divisions.length === 1} onClick={() => removeDivision(division.key)} aria-label={`${division.name || `종별 ${index + 1}`} 삭제`}>×</button>
        </div>)}
      </div>
      <button type="button" className="sport-division-add" disabled={busy || divisions.length >= 8} onClick={addDivision}>+ 종별 추가</button>
    </fieldset>
    <footer><button type="button" className="outline-button" disabled={busy} onClick={onCancel}>취소</button><button type="submit" className="solid-button" disabled={busy}>{busy ? "저장 중…" : "수정 내용 저장"}</button></footer>
  </form>;
}

function AdminPanel({ dashboard, refresh }: { dashboard: Dashboard; refresh: (eventId?: string) => Promise<void> }) {
  const [tab, setTab] = useState<"results" | "event" | "sports" | "account">("results");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<"all" | "sport" | null>(null);
  const [exportSportId, setExportSportId] = useState(dashboard.sports[0]?.id ?? "");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingSportId, setEditingSportId] = useState<string | null>(null);
  const [resultFilter, setResultFilter] = useState<"all" | "done" | "waiting">("all");
  const [resultQuery, setResultQuery] = useState("");
  const [selectedDivision, setSelectedDivision] = useState<{ eventId: string; sport: Sport; division: Division } | null>(null);
  const divisionModalRef = useRef<HTMLElement>(null);
  const divisionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = dashboard.selectedEvent;
  const selectedExportSportId = dashboard.sports.some((sport) => sport.id === exportSportId)
    ? exportSportId
    : dashboard.sports[0]?.id ?? "";
  const activeSelectedDivision = selectedDivision?.eventId === selected?.id ? selectedDivision : null;
  const responded = dashboard.rows.filter((row) => row.submitted);
  const noParticipation = responded.filter((row) => row.noParticipation);
  const participationRows = responded.filter((row) => !row.noParticipation);
  const filteredRows = dashboard.rows.filter((row) => row.school.name.includes(resultQuery.trim()) && (resultFilter === "all" || (resultFilter === "done" ? row.submitted : !row.submitted)));
  const divisionColumns = dashboard.sports.flatMap((sport) => sport.divisions.map((division) => ({ sport, division })));
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
    const payload = eventPayload(form);
    await run(async () => {
      const created = await api<{ id: string }>("admin/events", { method: "POST", body: JSON.stringify(payload) });
      await refresh(created.id);
      form.reset();
    }, "새 대회를 추가했습니다. 활성화하면 교사 화면에 반영됩니다.");
  }

  async function activateSelected() {
    if (!selected) return;
    await run(async () => {
      await api(`admin/events/${encodeURIComponent(selected.id)}/activate`, { method: "POST", body: "{}" });
      await refresh(selected.id);
    }, "해당 대회를 교사용 화면의 현재 대회로 설정했습니다.");
  }

  async function saveHeaderCopy(copy: Record<string, string>) {
    if (!selected) return;
    await run(async () => {
      await api(`admin/events/${encodeURIComponent(selected.id)}/header-copy`, { method: "PATCH", body: JSON.stringify({ headerCopy: copy }) });
      await refresh(selected.id);
    }, "상단 로고·제목을 저장했습니다. 현재 대회인 경우 교사 화면을 새로 열거나 새로고침하면 반영됩니다.");
  }

  async function saveCardCopy(copy: Record<string, string>) {
    if (!selected) return;
    await run(async () => {
      await api(`admin/events/${encodeURIComponent(selected.id)}/card-copy`, { method: "PATCH", body: JSON.stringify({ cardCopy: copy }) });
      await refresh(selected.id);
    }, "안내 카드 문구를 저장했습니다. 현재 대회인 경우 교사 화면에 바로 반영됩니다.");
  }

  async function addSport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const divisions = String(data.get("divisions") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    await run(async () => {
      await api("admin/sports", { method: "POST", body: JSON.stringify({ eventId: selected.id, name: data.get("name"), divisions, maxTeamsPerSchool: Number(data.get("maxTeamsPerSchool")), maxTeamsPerDivision: Number(data.get("maxTeamsPerDivision")) }) });
      await refresh(selected.id);
      form.reset();
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
    <aside className="admin-sidebar"><Brand admin /><nav><small>OVERVIEW</small><button type="button" className={tab === "results" ? "active" : ""} aria-current={tab === "results" ? "page" : undefined} onClick={() => setTab("results")}><span>≡</span>결과 종합</button><small>MANAGEMENT</small><button type="button" className={tab === "event" ? "active" : ""} aria-current={tab === "event" ? "page" : undefined} onClick={() => setTab("event")}><span>▣</span>대회·기간 설정</button><button type="button" className={tab === "sports" ? "active" : ""} aria-current={tab === "sports" ? "page" : undefined} onClick={() => setTab("sports")}><span>◉</span>종목 관리</button><button type="button" className={tab === "account" ? "active" : ""} aria-current={tab === "account" ? "page" : undefined} onClick={() => setTab("account")}><span>⚙</span>계정 설정</button></nav><div className="admin-side-foot"><span>{dashboard.adminUsername.slice(0, 1).toUpperCase()}</span><p><b>{dashboard.adminUsername}</b><small>참가 신청 설정·집계</small></p><button type="button" onClick={() => void logoutAdmin()} aria-label="관리자 로그아웃">↗</button></div></aside>
    <section className="admin-main">
      <header className="admin-topbar"><div><p>ADMIN CONSOLE</p><h1>{tab === "results" ? "참가 신청 결과 종합" : tab === "event" ? "대회·신청 기간 설정" : tab === "sports" ? "종목 관리" : "관리자 계정 설정"}</h1></div><div>{tab !== "account" && <label><span>조회 대회</span><select value={selected?.id ?? ""} disabled={busy || exporting !== null} onChange={(event) => { const eventId = event.target.value; setSelectedDivision(null); void run(() => refresh(eventId), ""); }}>{dashboard.events.map((tournament) => <option value={tournament.id} key={tournament.id}>{tournament.academicYear} · {tournament.name}{tournament.status === "active" ? " (현재)" : ""}</option>)}</select></label>}<a href="/" target="_blank" rel="noreferrer">교사 화면 ↗</a><button type="button" className="admin-topbar-logout" onClick={() => void logoutAdmin()}>로그아웃</button></div></header>
      {error && <div className="admin-flash error" role="alert"><SentenceFlow text={error} /></div>}
      {notice && <div className="admin-flash success" role="status"><SentenceFlow text={notice} /></div>}
      {tab === "account" ? <AdminAccountSettings currentUsername={dashboard.adminUsername} /> : !selected ? <section className="admin-empty"><b>등록된 대회가 없습니다.</b><button type="button" onClick={() => setTab("event")}>+ 첫 대회 추가</button></section> : tab === "results" ? <>
        <section className="dashboard-title"><div><p>{selected.academicYear} SCHOOL SPORTS</p><h2 title={selected.name}>{selected.name}</h2><small className="dashboard-meta"><span className="dashboard-meta-group"><span>{formatDate(selected.surveyStart)}</span><i aria-hidden="true">~</i><span>{formatDate(selected.surveyEnd)}</span></span><span className="dashboard-meta-group"><i aria-hidden="true">·</i><span>{dashboard.surveyState?.message}</span></span></small></div><span className={`status-chip ${dashboard.surveyState?.open ? "open" : "closed"}`}>{dashboard.surveyState?.open ? "진행 중" : "접수 중지"}</span></section>
        <section className="metric-grid"><article><span>전체 대상 학교</span><b>{dashboard.rows.length}<small>개교</small></b></article><article><span>신청 완료</span><b>{responded.length}<small>개교</small></b><i style={{ width: `${dashboard.rows.length ? (responded.length / dashboard.rows.length) * 100 : 0}%` }} /></article><article><span>미신청</span><b>{dashboard.rows.length - responded.length}<small>개교</small></b></article><article><span>참가 신청 없음</span><b>{noParticipation.length}<small>개교</small></b></article></section>
        <section className="sport-metrics" aria-label="종목과 종별 참가 현황">{sportMetrics.map(({ sport, schoolCount, teamCount, divisionMetrics }) => <article className={sport.active ? "" : "inactive"} key={sport.id}>
          <header className="sport-metric-head"><div className="sport-metric-title"><span title={sport.name}>{sport.name}</span>{!sport.active && <small>비활성 종목</small>}</div><div className="sport-metric-totals"><p><b>{schoolCount}</b><small>참가 학교</small></p><p><b>{teamCount}</b><small>신청 팀</small></p></div></header>
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
        <section className="results-panel"><header><div><p>ALL SCHOOLS</p><h2>학교별 신청 현황</h2></div><span>{responded.length} / {dashboard.rows.length}개교 신청</span></header><div className="results-filter-bar"><div className="result-tabs" role="group" aria-label="신청 상태 필터">{([{ value: "all", label: "전체", count: dashboard.rows.length }, { value: "done", label: "신청 완료", count: responded.length }, { value: "waiting", label: "미신청", count: dashboard.rows.length - responded.length }] as const).map((item) => <button type="button" key={item.value} aria-pressed={resultFilter === item.value} onClick={() => setResultFilter(item.value)}>{item.label} {item.count}</button>)}</div><input type="search" aria-label="결과 학교명 검색" placeholder="학교명 검색" value={resultQuery} onChange={(event) => setResultQuery(event.target.value)} /></div><div className="results-table-wrap"><table><caption className="sr-only">{selected.name} 학교별 신청 현황</caption><thead><tr><th scope="col">#</th><th scope="col">학교명</th><th scope="col">신청 상태</th>{divisionColumns.map(({ sport, division }) => <th scope="col" key={division.id}><small>{sport.name}</small>{division.name}</th>)}<th scope="col">마지막 저장</th></tr></thead><tbody>{filteredRows.map((row) => <tr key={row.school.id}><td>{row.school.displayOrder}</td><td><b title={row.school.name}>{row.school.name}</b></td><td><span className={`response-status ${!row.submitted ? "waiting" : row.noParticipation ? "none" : "done"}`}>{!row.submitted ? "미신청" : row.noParticipation ? "신청 없음" : "신청 완료"}</span></td>{divisionColumns.map(({ division }) => { const count = selectionCount(row, division.id); return <td key={division.id}>{count ? <b>{count}팀</b> : <span className="dash">-</span>}</td>; })}<td>{formatDate(row.updatedAt)}</td></tr>)}{!filteredRows.length && <tr><td colSpan={divisionColumns.length + 4}>조건에 맞는 학교가 없습니다.</td></tr>}</tbody></table></div></section>
      </> : tab === "event" ? <section className="admin-settings-grid">
        <article className="settings-card"><header><span>01</span><div><p>CURRENT EVENT</p><h2>대회 정보·신청 기간</h2></div></header><form key={selected.id} onSubmit={updateSelectedEvent}><div className="form-two"><label><span>학년도</span><input name="academicYear" type="number" min="2020" max="2100" defaultValue={selected.academicYear} required /></label><label><span>대회 상태</span><input value={selected.status === "active" ? "현재 교사 화면에 공개 중" : "임시저장 · 비공개"} disabled /></label></div><label><span>대회명</span><input name="name" defaultValue={selected.name} required /></label><div className="form-two"><label><span>신청 시작 · 한국시간</span><input name="surveyStart" type="datetime-local" defaultValue={seoulInputValue(selected.surveyStart)} required /></label><label><span>신청 종료 · 한국시간</span><input name="surveyEnd" type="datetime-local" defaultValue={seoulInputValue(selected.surveyEnd)} required /></label></div><footer><button type="button" className="outline-button" disabled={busy || selected.status === "active"} onClick={() => void activateSelected()}>{selected.status === "active" ? "현재 대회" : "이 대회를 현재 대회로 설정"}</button><button className="solid-button" disabled={busy}>변경 사항 저장</button></footer></form></article>
        <article className="settings-card new-event-card"><header><span>02</span><div><p>NEW EVENT</p><h2>새 대회 추가</h2></div></header><p>새 대회에는 배구·3x3 농구·피구가 기본 종목으로 추가됩니다.</p><form onSubmit={createNewEvent}><div className="form-two"><label><span>학년도</span><input name="academicYear" type="number" min="2020" max="2100" defaultValue={selected.academicYear + 1} required /></label><label><span>대회명</span><input name="name" placeholder="예: 동부학교스포츠클럽 전반기 대회" required /></label></div><div className="form-two"><label><span>신청 시작 · 한국시간</span><input name="surveyStart" type="datetime-local" defaultValue={newStart} required /></label><label><span>신청 종료 · 한국시간</span><input name="surveyEnd" type="datetime-local" defaultValue={seoulInputValue(newEndDate)} required /></label></div><button className="solid-button" disabled={busy}>+ 새 대회 추가</button></form></article>
        <PageHeaderEditor key={`header-${selected.id}-${selected.headerCopy}`} tournament={selected} busy={busy} onSave={saveHeaderCopy} />
        <EventCardEditor key={`card-${selected.id}-${selected.cardCopy}-${selected.academicYear}-${selected.name}`} tournament={selected} sports={dashboard.sports} schoolCount={dashboard.rows.length} busy={busy} onSave={saveCardCopy} />
      </section> : <section className="admin-settings-grid sports-management">
        <article className="settings-card"><header><span>01</span><div><p>SPORTS LIST</p><h2 title={selected.name}>{selected.name} 종목</h2></div></header><p className="prose-copy"><span className="sentence-unit">종별과 팀 수 기준을 수정할 수 있습니다.</span>{" "}<span className="sentence-unit">신청 기록이 있는 종목은 삭제할 수 없으며 신청 기간 중에는 비활성화도 제한됩니다.</span></p><div className="managed-sports">{dashboard.sports.map((sport) => <section className={`managed-sport-card${sport.active ? "" : " inactive"}`} key={sport.id} aria-labelledby={`sport-name-${sport.id}`}>
          <div className="managed-sport-summary"><span className="managed-sport-icon" aria-hidden="true">{sport.name.slice(0, 1)}</span><div className="managed-sport-copy"><span><b id={`sport-name-${sport.id}`} title={sport.name}>{sport.name}</b><i className={sport.active ? "active" : "inactive"}>{sport.active ? "활성" : "비활성"}</i></span><small title={`${sport.divisions.map((division) => division.name).join(" · ")} · ${teamLimitLabel(sport)}`}>{sport.divisions.map((division) => division.name).join(" · ")} · 학교 전체 최대 <span className="number-unit">{sport.maxTeamsPerSchool}팀</span> · 한 종별 최대 <span className="number-unit">{sport.maxTeamsPerDivision}팀</span></small></div><div className="managed-sport-actions"><button type="button" disabled={busy} aria-expanded={editingSportId === sport.id} aria-controls={`sport-editor-${sport.id}`} aria-label={`${sport.name} 수정`} onClick={() => setEditingSportId((current) => current === sport.id ? null : sport.id)}>{editingSportId === sport.id ? "닫기" : "수정"}</button><button type="button" disabled={busy} aria-label={`${sport.name} ${sport.active ? "비활성화" : "활성화"}`} onClick={() => void toggleSportActive(sport)}>{sport.active ? "비활성화" : "활성화"}</button><button type="button" className="delete" disabled={busy} aria-label={`${sport.name} 삭제`} onClick={() => void removeSport(sport)}>삭제</button></div></div>
          {editingSportId === sport.id && <div id={`sport-editor-${sport.id}`}><SportEditor key={`${sport.id}-${sport.divisions.map((division) => division.id).join("-")}`} sport={sport} busy={busy} onSave={(payload) => updateExistingSport(sport.id, payload)} onCancel={() => setEditingSportId(null)} /></div>}
        </section>)}</div></article>
        <article className="settings-card"><header><span>02</span><div><p>ADD SPORT</p><h2>새 종목 추가</h2></div></header><form onSubmit={addSport}><label><span>종목명</span><input name="name" placeholder="예: 배드민턴" required /></label><label><span>종별 <small>쉼표로 구분</small></span><input name="divisions" defaultValue="남중부, 여중부" required /></label><div className="form-two"><label><span>학교 전체 최대 팀 수 <small>모든 종별 합계</small></span><input name="maxTeamsPerSchool" type="number" min="1" max="20" defaultValue="2" required /></label><label><span>한 종별 최대 팀 수 <small>남중부·여중부 각각</small></span><input name="maxTeamsPerDivision" type="number" min="1" max="20" defaultValue="1" required /></label></div><p className="team-limit-rule-note">예: 전체 2팀·한 종별 1팀은 남중부 1팀과 여중부 1팀만 가능합니다.</p><button className="solid-button" disabled={busy}>+ 종목 추가</button></form></article>
      </section>}
    </section>
    {activeSelectedDivision && <div className="division-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedDivision(null); }}>
      <section id="division-participants-dialog" className="division-participants-modal" ref={divisionModalRef} role="dialog" aria-modal="true" aria-labelledby="division-modal-title" aria-describedby="division-modal-description">
        <header><div><p>DIVISION PARTICIPANTS</p><h2 id="division-modal-title"><span className="division-modal-sport" title={activeSelectedDivision.sport.name}>{activeSelectedDivision.sport.name}</span><span className="division-modal-name" title={activeSelectedDivision.division.name}>· {activeSelectedDivision.division.name}</span></h2><small id="division-modal-description" title={selected?.name}>{selected?.name} 참가 신청 학교</small></div><button type="button" className="division-modal-close" aria-label="참가 학교 모달 닫기" onClick={() => setSelectedDivision(null)}>×</button></header>
        <div className="division-modal-summary"><p><span>참가 학교</span><b>{selectedDivisionParticipants.length}<small>개교</small></b></p><p><span>신청 팀</span><b>{selectedDivisionTeamCount}<small>팀</small></b></p></div>
        <div className="division-participant-list">{selectedDivisionParticipants.length ? <ol>{selectedDivisionParticipants.map(({ row, teamCount }) => <li key={row.school.id}><span>{row.school.displayOrder}</span><p><b title={row.school.name}>{row.school.name}</b><small>학교 순번 {row.school.displayOrder}</small></p><strong>{teamCount}<small>팀</small></strong></li>)}</ol> : <div className="division-participant-empty"><span>–</span><b>아직 신청한 학교가 없습니다.</b><small>해당 종별에 저장된 신청 팀이 없습니다.</small></div>}</div>
        <footer><small>학교는 로그인 페이지에 등록된 순서로 표시됩니다.</small><button type="button" onClick={() => setSelectedDivision(null)}>확인</button></footer>
      </section>
    </div>}
  </main>;
}
