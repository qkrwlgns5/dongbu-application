// Plain-text, per-tournament presentation settings. Dates, sports and school totals
// are always read from live tournament data rather than administrator copy.
export const EVENT_CARD_FIELDS = [
  { key: "eyebrow", label: "상단 영문·시즌 문구", max: 60 },
  { key: "badge", label: "상단 안내 문구", max: 30 },
  { key: "title", label: "큰 제목", max: 100 },
  { key: "subtitle", label: "제목 아래 문구", max: 100 },
  { key: "description", label: "학년도·참가 신청 안내", max: 160 },
  { key: "target", label: "참가 대상", max: 100 },
  { key: "footer", label: "하단 안내 문구", max: 100 },
];

const cardDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatEventCardDate(value) {
  if (!value) return "-";
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "-";
  const parts = cardDateFormatter.formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("month")}.${get("day")}.(${get("weekday")}) ${get("hour")}:${get("minute")}`;
}

export function normalizeEventCardCopy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("안내 카드 문구를 확인해 주세요.");
  const result = {};
  for (const field of EVENT_CARD_FIELDS) {
    if (value[field.key] === undefined) continue;
    if (typeof value[field.key] !== "string") throw new Error(`${field.label}는 문자로 입력해 주세요.`);
    const text = value[field.key].normalize("NFC").replace(/\r\n?/g, "\n").trim();
    if (text.length > field.max) throw new Error(`${field.label}는 ${field.max}자 이내로 입력해 주세요.`);
    result[field.key] = text;
  }
  return result;
}

export function eventCardCopy(tournament, override) {
  const year = tournament?.academicYear ?? new Date().getFullYear();
  const isDongbu = tournament?.name?.includes("동부동락");
  const secondHalf = /하반기|후반기/.test(tournament?.name ?? "");
  const defaults = {
    eyebrow: `${year} · ${secondHalf ? "SECOND HALF" : "SCHOOL SPORTS"}`,
    badge: "참가 안내",
    title: isDongbu ? "동부동락" : (tournament?.name ?? "대회 준비 중"),
    subtitle: isDongbu ? "학교스포츠클럽대회" : "",
    description: `${year}학년도${secondHalf ? " 하반기" : ""} 참가 신청`,
    target: "동부 관내 중학교",
    footer: "학교별 온라인 신청",
  };
  let saved = {};
  try { saved = normalizeEventCardCopy(override ?? JSON.parse(tournament?.cardCopy ?? "{}")); } catch { /* Fall back safely for older or invalid stored settings. */ }
  return { ...defaults, ...saved };
}
