export const PAGE_HEADER_FIELDS = [
  { key: "logoText", label: "로고 문자", max: 3, required: true, multiline: false },
  { key: "brandName", label: "로고 옆 기관명", max: 40, required: true, multiline: false },
  { key: "brandSubtitle", label: "기관명 아래 문구", max: 60, required: false, multiline: false },
  { key: "eyebrow", label: "학년도 배지 옆 영문·안내 문구", max: 80, required: false, multiline: false },
  { key: "titlePrimary", label: "메인 제목 첫째 줄", max: 100, required: true, multiline: true },
  { key: "titleSecondary", label: "메인 제목 둘째 줄", max: 100, required: false, multiline: true },
];

const DEFAULT_COPY = {
  logoText: "D",
  brandName: "동부교육지원청",
  brandSubtitle: "학교스포츠클럽",
  eyebrow: "DONG-BU SCHOOL SPORTS",
  titlePrimary: "동부교육지원청 학교스포츠클럽대회",
  titleSecondary: "참가 신청",
};

export function normalizePageHeaderCopy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("상단 문구를 확인해 주세요.");
  const result = {};
  for (const field of PAGE_HEADER_FIELDS) {
    if (value[field.key] === undefined) continue;
    if (typeof value[field.key] !== "string") throw new Error(`${field.label}은 문자로 입력해 주세요.`);
    let text = value[field.key].normalize("NFC").replace(/\r\n?/g, "\n").trim();
    if (!field.multiline) text = text.replace(/\s+/gu, " ");
    if (field.required && !text) throw new Error(`${field.label}을 입력해 주세요.`);
    if (text.length > field.max) throw new Error(`${field.label}은 ${field.max}자 이내로 입력해 주세요.`);
    if (field.key === "logoText" && !/^[\p{L}\p{N}]{1,3}$/u.test(text)) throw new Error("로고 문자는 공백 없이 한글·영문·숫자 1~3자로 입력해 주세요.");
    result[field.key] = text;
  }
  return result;
}

export function pageHeaderCopy(tournament, override) {
  let saved = {};
  try { saved = normalizePageHeaderCopy(JSON.parse(tournament?.headerCopy ?? "{}")); } catch { /* Preserve the original header when settings are absent or invalid. */ }
  // Preview drafts may be incomplete. They remain plain React text and are
  // validated on the server when saved. Only known fields can be displayed.
  const draft = {};
  if (override) for (const { key } of PAGE_HEADER_FIELDS) if (typeof override[key] === "string") draft[key] = override[key];
  return { ...DEFAULT_COPY, ...saved, ...draft };
}
