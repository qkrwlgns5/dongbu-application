export const SCHOOL_LEVELS = [
  { value: "elementary", label: "초등학교", shortLabel: "초등", maleDivision: "남초부", femaleDivision: "여초부" },
  { value: "middle", label: "중학교", shortLabel: "중등", maleDivision: "남중부", femaleDivision: "여중부" },
];

// Legacy surveys and fixtures without this field remain middle-school only.
export function schoolLevels(value) {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { return ["middle"]; }
  }
  if (!Array.isArray(parsed)) return ["middle"];
  const levels = SCHOOL_LEVELS.map(({ value }) => value).filter(level => parsed.includes(level));
  return levels.length ? levels : ["middle"];
}

export function validateSchoolLevels(value) {
  if (!Array.isArray(value) || !value.length || value.some(level => !SCHOOL_LEVELS.some(option => option.value === level))) {
    throw new Error("참가 대상 학교급을 하나 이상 선택해 주세요.");
  }
  return SCHOOL_LEVELS.map(option => option.value).filter(level => value.includes(level));
}

export function schoolLevelLabel(value) {
  return SCHOOL_LEVELS.find(level => level.value === value)?.label ?? "중학교";
}

export function schoolLevelsLabel(value) {
  return schoolLevels(value).map(schoolLevelLabel).join("·");
}
