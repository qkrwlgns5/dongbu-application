import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  createSurveyWorkbookFile,
  makeUniqueSheetName,
  normalizeDatabaseDate,
  sanitizeFilenamePart,
  workbookInternals,
} from "../app/survey-workbook.js";

const root = new URL("../", import.meta.url);
const exportedAt = new Date("2026-08-31T05:30:00.000Z");
const invalidSheetCharacters = new RegExp("[\\[\\]:*?/\\\\]", "u");

function isForbiddenFilenameCharacter(character) {
  const codePoint = character.codePointAt(0) ?? 0;
  return '<>:"/\\|?*'.includes(character)
    || (codePoint >= 0 && codePoint <= 31)
    || (codePoint >= 127 && codePoint <= 159)
    || (codePoint >= 0x202A && codePoint <= 0x202E)
    || (codePoint >= 0x2066 && codePoint <= 0x2069);
}

function fixtureDashboard() {
  return {
    adminUsername: "admin-secret-never-export",
    events: [],
    selectedEvent: {
      id: "event-secret-never-export",
      academicYear: 2026,
      name: "후반기/대회:*?\"<>| =1+1",
      surveyStart: "2026-08-24T00:00:00.000Z",
      surveyEnd: "2026-09-04T09:00:00.000Z",
      status: "active",
    },
    surveyState: { open: true, code: "OPEN", message: "참가 신청 진행 중" },
    sports: [
      {
        id: "sport-secret-never-export",
        name: "배구",
        displayOrder: 1,
        teamCountEnabled: true,
        maxTeamsPerSchool: 2,
        maxTeamsPerDivision: 2,
        active: true,
        divisions: [
          { id: "division-secret-never-export", name: "남중부", displayOrder: 1, active: true },
          { id: "division-inactive-secret", name: "여중부", displayOrder: 2, active: false },
        ],
      },
      {
        id: "other-sport-secret",
        name: "피구-다른종목-비밀표식",
        displayOrder: 2,
        teamCountEnabled: false,
        maxTeamsPerSchool: 1,
        maxTeamsPerDivision: 1,
        active: false,
        divisions: [
          { id: "other-division-secret", name: "여중부-다른종목", displayOrder: 1, active: false },
        ],
      },
    ],
    rows: [
      {
        school: { id: "school-secret-never-export", name: "=HYPERLINK(\"https://evil.invalid\",\"학교\")", displayOrder: 1 },
        submitted: true,
        noParticipation: false,
        revision: 987654321,
        updatedAt: "2026-08-31 01:00:00",
        selections: [
          { divisionId: "division-secret-never-export", teamCount: 2 },
          { divisionId: "other-division-secret", teamCount: 1 },
        ],
      },
      {
        school: { id: "school-two-secret", name: "@SUM(1,1)중학교", displayOrder: 2 },
        submitted: true,
        noParticipation: true,
        revision: 2,
        updatedAt: "2026-08-31T02:00:00.000Z",
        selections: [{ divisionId: "division-secret-never-export", teamCount: 2 }],
      },
      {
        school: { id: "school-three-secret", name: "\u200B=WEBSERVICE(\"https://evil.invalid\")", displayOrder: 3 },
        submitted: false,
        noParticipation: false,
        revision: 0,
        updatedAt: null,
        selections: [{ divisionId: "division-secret-never-export", teamCount: 2 }],
      },
    ],
  };
}

function mixedSchoolDashboard() {
  const dashboard = fixtureDashboard();
  dashboard.selectedEvent.schoolLevels = '["elementary","middle"]';
  dashboard.sports[0].divisions.push(
    { id: "elementary-male-secret", name: "남초부", schoolLevel: "elementary", displayOrder: 3, active: true },
    { id: "elementary-female-secret", name: "여초부", schoolLevel: "elementary", displayOrder: 4, active: true },
  );
  const makeRow = (level, displayOrder) => ({
    school: {
      id: `${level}-${displayOrder}-school-secret`,
      name: `${level === "elementary" ? "초등" : "중등"}${displayOrder}학교`,
      schoolLevel: level,
      displayOrder,
      passwordHash: "school-password-never-export",
    },
    submitted: displayOrder === 1 || (level === "elementary" && displayOrder === 2),
    noParticipation: level === "elementary" && displayOrder === 2,
    updatedAt: displayOrder === 1 ? "2026-08-31 01:00:00" : null,
    revision: 1,
    selections: displayOrder === 1
      ? level === "elementary"
        ? [{ divisionId: "elementary-male-secret", teamCount: 2 }, { divisionId: "elementary-female-secret", teamCount: 1 }]
        : [{ divisionId: "division-secret-never-export", teamCount: 2 }, { divisionId: "other-division-secret", teamCount: 1 }, { divisionId: "elementary-male-secret", teamCount: 99 }]
      : [],
  });
  // The two school levels have independent 1-based ordinals. Input order is
  // intentionally middle first and descending within each level.
  dashboard.rows = [
    ...Array.from({ length: 42 }, (_, index) => makeRow("middle", 42 - index)),
    ...Array.from({ length: 73 }, (_, index) => makeRow("elementary", 73 - index)),
  ];
  // Existing middle-school data is allowed to omit schoolLevel.
  delete dashboard.rows.find((row) => row.school.name === "중등1학교").school.schoolLevel;
  dashboard.schools = [{ id: "unrelated-school-id", name: "대상외학교-비밀표식", displayOrder: 1 }];
  dashboard.events = [{ id: "unrelated-event-id", name: "다른대회-비밀표식" }];
  return dashboard;
}

async function loadWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

async function readZipText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const textFiles = Object.values(zip.files).filter((file) => !file.dir && /(?:\.xml|\.rels)$/u.test(file.name));
  const contents = await Promise.all(textFiles.map((file) => file.async("string")));
  return { zip, text: contents.join("\n") };
}

function everyCell(workbook) {
  const cells = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => cells.push(cell)));
  });
  return cells;
}

test("creates a polished all-sports workbook with screen-equivalent totals", async () => {
  const dashboard = fixtureDashboard();
  const file = await createSurveyWorkbookFile(dashboard, { now: exportedAt });
  assert.deepEqual([...file.buffer.slice(0, 2)], [0x50, 0x4b]);
  assert.match(file.filename, /^2026_후반기_대회_=1\+1_참가신청결과_전체_20260831_1430\.xlsx$/u);
  assert.doesNotMatch(file.filename, /[<>:"/\\|?*\r\n]/u);

  const workbook = await loadWorkbook(file.buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    "종합 요약",
    "학교별 전체현황",
    "배구 참가학교",
    "피구-다른종목-비밀표식 참가학교",
    "종별 참가학교",
  ]);
  const summary = workbook.getWorksheet("종합 요약");
  assert.ok(summary);
  assert.equal(summary.getCell("A6").value, 3, "전체 대상 학교");
  assert.equal(summary.getCell("C6").value, 2, "신청 완료");
  assert.equal(summary.getCell("E6").value, 1, "미신청");
  assert.equal(summary.getCell("G6").value, 2 / 3, "신청률");
  assert.equal(summary.getCell("A9").value, 1, "참가 신청 학교");
  assert.equal(summary.getCell("C9").value, 1, "참가 신청 없음");
  assert.equal(summary.getCell("E9").value, 3, "전체 신청 팀");
  assert.equal(summary.getCell("D13").value, 1, "배구 참가 학교");
  assert.equal(summary.getCell("E13").value, 2, "배구 신청 팀");
  assert.equal(summary.getCell("F12").value, "학교 전체 최대");
  assert.equal(summary.getCell("G12").value, "한 종별 최대");
  assert.equal(summary.getCell("F13").value, 2, "배구 학교 전체 최대");
  assert.equal(summary.getCell("G13").value, 2, "배구 한 종별 최대");
  assert.equal(summary.getCell("D16").value, 1, "팀 수 입력을 쓰지 않는 피구 참가 학교");
  assert.equal(summary.getCell("E16").value, 1, "피구 신청 팀");

  const schools = workbook.getWorksheet("학교별 전체현황");
  assert.ok(schools);
  assert.equal(schools.getCell("A4").value, "순번", "기존 중학교 전용 머리글 유지");
  assert.equal(schools.getCell("A6").value, 1, "기존 중학교 전용 순번은 숫자로 유지");
  assert.equal(schools.getColumn(1).width, 7, "기존 중학교 전용 열 너비 유지");
  assert.equal(schools.getCell("C6").value, "신청 완료");
  assert.equal(schools.getCell("E6").value, 3);
  assert.equal(schools.getCell("C7").value, "참가 신청 없음");
  assert.equal(schools.getCell("E7").value, 0, "참가 신청 없음 행은 방어적으로 0팀");
  assert.equal(schools.getCell("C8").value, "미신청");
  assert.equal(schools.getCell("E8").value, null);
  assert.ok(schools.getCell("K6").value instanceof Date);
  assert.equal(schools.getCell("K6").value.toISOString(), "2026-08-31T10:00:00.000Z", "D1 UTC 시각을 한국 현지시각으로 저장");
  assert.equal(schools.views[0].state, "frozen");
  assert.equal(schools.views[0].ySplit, 5, "표 머리글 행 고정 유지");
  assert.equal(schools.views[0].xSplit ?? 0, 0, "세로 틀 고정 경계선 없음");
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.views[0]?.xSplit ?? 0, 0, `${sheet.name}: 세로 틀 고정 경계선 없음`);
  }
  assert.ok(schools.autoFilter);
  assert.equal(schools.pageSetup.orientation, "landscape");
});

test("creates a selected-sport workbook without leaking other sports or internal values", async () => {
  const dashboard = fixtureDashboard();
  const file = await createSurveyWorkbookFile(dashboard, { sportId: "sport-secret-never-export", now: exportedAt });
  assert.match(file.filename, /_참가신청결과_배구_20260831_1430\.xlsx$/u);
  const workbook = await loadWorkbook(file.buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["종목 요약", "배구 참가학교", "전체학교 확인"]);
  assert.equal(workbook.getWorksheet("종목 요약").getCell("E6").value, 1, "배구 참가 학교");
  assert.equal(workbook.getWorksheet("종목 요약").getCell("G6").value, 2, "배구 신청 팀");
  assert.equal(workbook.getWorksheet("종목 요약").getCell("E9").value, 2, "배구 학교 전체 최대");
  assert.equal(workbook.getWorksheet("종목 요약").getCell("G9").value, 2, "배구 한 종별 최대");
  assert.equal(workbook.getWorksheet("배구 참가학교").getCell("E6").value, 2, "참가학교 시트 학교 전체 최대");
  assert.equal(workbook.getWorksheet("배구 참가학교").getCell("G6").value, 2, "참가학교 시트 한 종별 최대");
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.views[0]?.xSplit ?? 0, 0, `${sheet.name}: 세로 틀 고정 경계선 없음`);
  }
  assert.equal(workbook.getWorksheet("배구 참가학교").views[0].ySplit, 9, "참가학교 표 머리글 행 고정 유지");
  assert.equal(workbook.getWorksheet("전체학교 확인").views[0].ySplit, 9, "전체학교 표 머리글 행 고정 유지");

  for (const cell of everyCell(workbook)) {
    if (cell.value && typeof cell.value === "object") {
      assert.equal("formula" in cell.value, false, `수식 셀 금지: ${cell.address}`);
      assert.equal("hyperlink" in cell.value, false, `하이퍼링크 셀 금지: ${cell.address}`);
    }
  }

  const { zip, text } = await readZipText(file.buffer);
  assert.match(text, /=HYPERLINK/u, "위험한 선행문자도 값은 문자열로 보존");
  assert.doesNotMatch(text, /<f(?:\s|>)/u, "사용자 입력이나 합계를 수식 노드로 내보내지 않음");
  assert.doesNotMatch(text, /TargetMode=["']External["']/u);
  assert.equal(Object.keys(zip.files).some((name) => name.startsWith("xl/externalLinks/") || name.endsWith("vbaProject.bin")), false);
  assert.doesNotMatch(text, /피구-다른종목-비밀표식|여중부-다른종목/u);
  assert.doesNotMatch(text, /event-secret-never-export|sport-secret-never-export|division-secret-never-export|school-secret-never-export|admin-secret-never-export|987654321/u);
});

test("keeps 115 mixed-level schools distinct and totals only matching divisions", async () => {
  const dashboard = mixedSchoolDashboard();
  const originalOrder = dashboard.rows.map((row) => row.school.id);
  const file = await createSurveyWorkbookFile(dashboard, { now: exportedAt });
  const workbook = await loadWorkbook(file.buffer);
  const summary = workbook.getWorksheet("종합 요약");
  assert.equal(summary.getCell("A6").value, 115, "초등 73개교와 중등 42개교를 각각 집계");
  assert.equal(summary.getCell("C6").value, 3);
  assert.equal(summary.getCell("E6").value, 112);
  assert.equal(summary.getCell("G6").value, 3 / 115, "신청률 분모는 대회 대상 학교");
  assert.equal(summary.getCell("A9").value, 2);
  assert.equal(summary.getCell("C9").value, 1);
  assert.equal(summary.getCell("E9").value, 6, "다른 학교급 종별에 잘못 연결된 99팀 제외");
  assert.equal(summary.getCell("G9").value, 1, "학교급 불일치는 확인 필요 건수로 표시");
  assert.equal(summary.getCell("D13").value, 2);
  assert.equal(summary.getCell("E13").value, 5);
  assert.equal(summary.getCell("B14").value, "↳ 남초부");
  assert.equal(summary.getCell("D14").value, 1);
  assert.equal(summary.getCell("E14").value, 2);
  assert.match(summary.getCell("A2").value, /초등학교·중학교/u);

  const schools = workbook.getWorksheet("학교별 전체현황");
  assert.equal(schools.getCell("A4").value, "학교급 · 순번");
  assert.equal(schools.getCell("A6").value, "초등 1");
  assert.equal(schools.getCell("B6").value, "초등1학교");
  assert.equal(schools.getCell("A78").value, "초등 73");
  assert.equal(schools.getCell("A79").value, "중등 1");
  assert.equal(schools.getCell("B79").value, "중등1학교");
  assert.equal(schools.getCell("A120").value, "중등 42");
  assert.equal(schools.getCell("E6").value, 3);
  assert.equal(schools.getCell("E79").value, 3);
  assert.equal(schools.getCell("E121").value, 6);
  assert.equal(schools.getCell("F79").value, 0, "중학교 신청이 남초부 집계로 넘어가지 않음");
  assert.equal(schools.getCell("H6").value, 0, "초등학교 남중부 집계는 0");

  const sport = workbook.getWorksheet("배구 참가학교");
  assert.equal(sport.getCell("A9").value, "학교급 · 순번");
  assert.equal(sport.getCell("A10").value, "초등 1");
  assert.equal(sport.getCell("A11").value, "중등 1");
  assert.equal(sport.getCell("C10").value, 2);
  assert.equal(sport.getCell("C11").value, 0);
  assert.equal(sport.getCell("G12").value, 5);

  const divisions = workbook.getWorksheet("종별 참가학교");
  assert.equal(divisions.getCell("C5").value, "학교급 · 순번");
  assert.equal(divisions.getCell("B6").value, "남초부");
  assert.equal(divisions.getCell("C6").value, "초등 1");
  assert.equal(divisions.getCell("C8").value, "중등 1");
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.views[0]?.xSplit ?? 0, 0, `${sheet.name}: 세로 틀 고정 없음`);
  }
  assert.deepEqual(dashboard.rows.map((row) => row.school.id), originalOrder, "내보내기는 원본 순서를 변경하지 않음");
});

test("mixed-level selected-sport export preserves scope and eligible-school denominators", async () => {
  const dashboard = mixedSchoolDashboard();
  const file = await createSurveyWorkbookFile(dashboard, { sportId: "sport-secret-never-export", now: exportedAt });
  const workbook = await loadWorkbook(file.buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["종목 요약", "배구 참가학교", "전체학교 확인"]);
  const summary = workbook.getWorksheet("종목 요약");
  assert.equal(summary.getCell("A6").value, 115);
  assert.equal(summary.getCell("E6").value, 2);
  assert.equal(summary.getCell("G6").value, 5);
  const schools = workbook.getWorksheet("전체학교 확인");
  assert.equal(schools.getCell("A9").value, "학교급 · 순번");
  assert.equal(schools.getCell("A10").value, "초등 1");
  assert.equal(schools.getCell("A83").value, "중등 1");
  assert.equal(schools.getCell("H10").value, 3);
  assert.equal(schools.getCell("H83").value, 2);
  assert.equal(schools.views[0].ySplit, 9);
  assert.equal(schools.views[0].xSplit ?? 0, 0);
  const { text } = await readZipText(file.buffer);
  assert.doesNotMatch(text, /피구-다른종목-비밀표식|여중부-다른종목|대상외학교-비밀표식|다른대회-비밀표식/u);
  assert.doesNotMatch(text, /elementary-male-secret|elementary-female-secret|school-password-never-export|event-secret-never-export|admin-secret-never-export/u);

  dashboard.selectedEvent.schoolLevels = '["elementary"]';
  dashboard.rows = dashboard.rows.filter((row) => row.school.schoolLevel === "elementary");
  const elementaryFile = await createSurveyWorkbookFile(dashboard, { sportId: "sport-secret-never-export", now: exportedAt });
  const elementaryWorkbook = await loadWorkbook(elementaryFile.buffer);
  const elementarySummary = elementaryWorkbook.getWorksheet("종목 요약");
  assert.equal(elementarySummary.getCell("A6").value, 73, "백엔드에서 선택된 대상 학교만 분모에 사용");
  assert.equal(elementarySummary.getCell("C6").value, 2);
  assert.equal(elementarySummary.getCell("G6").value, 3);
  assert.match(elementarySummary.getCell("A2").value, /초등학교/u);
  assert.doesNotMatch(elementarySummary.getCell("A2").value, /중학교/u);
  const elementaryText = (await readZipText(elementaryFile.buffer)).text;
  assert.doesNotMatch(elementaryText, /중등1학교|대상외학교-비밀표식|다른대회-비밀표식/u);
});

test("sanitizes file and sheet names without splitting Unicode characters", () => {
  const filenamePart = sanitizeFilenamePart("후반기/대회:*?\"<>|\r\nX-Evil: injected\u202Eslx.exe");
  assert.equal(filenamePart, "후반기 대회 X-Evil injectedslx.exe");
  assert.equal([...filenamePart].some(isForbiddenFilenameCharacter), false);

  const usedNames = new Set();
  const names = [
    makeUniqueSheetName("남/여 배구:*?[]", usedNames),
    makeUniqueSheetName("History", usedNames),
    makeUniqueSheetName("'배구'", usedNames),
    makeUniqueSheetName("A".repeat(60), usedNames),
    makeUniqueSheetName("😀".repeat(20), usedNames),
    makeUniqueSheetName(`${"A".repeat(30)}'${"B".repeat(8)}`, usedNames),
    makeUniqueSheetName("배구", usedNames),
  ];
  assert.equal(new Set(names.map((name) => name.toLocaleLowerCase("en-US"))).size, names.length);
  for (const name of names) {
    assert.ok(name.length >= 1 && name.length <= 31);
    assert.equal(invalidSheetCharacters.test(name), false);
    assert.doesNotMatch(name, /^'|'$/u);
    assert.equal(name.endsWith("\uD83D"), false, "surrogate pair 중간에서 자르지 않음");
  }
});

test("normalizes SQLite timestamps as UTC and uses consistent team-count rules", () => {
  assert.equal(normalizeDatabaseDate("2026-08-31 00:00:00").toISOString(), "2026-08-31T00:00:00.000Z");
  assert.equal(normalizeDatabaseDate("2026-08-31T00:00:00Z").toISOString(), "2026-08-31T00:00:00.000Z");
  assert.equal(normalizeDatabaseDate("not-a-date"), null);
  assert.equal(normalizeDatabaseDate(null), null);
  const dashboard = fixtureDashboard();
  const row = dashboard.rows[0];
  assert.equal(workbookInternals.selectionCount(row, dashboard.sports[0], "division-secret-never-export"), 2);
  assert.equal(workbookInternals.selectionCount(row, dashboard.sports[1], "other-division-secret"), 1);
  assert.equal(workbookInternals.selectionCount(dashboard.rows[1], dashboard.sports[0], "division-secret-never-export"), 0);
});

test("exports empty events and long apostrophe-edge sport names without corrupting sheet names", async () => {
  const emptyDashboard = fixtureDashboard();
  emptyDashboard.sports = [];
  emptyDashboard.rows = [];
  const emptyFile = await createSurveyWorkbookFile(emptyDashboard, { now: exportedAt });
  const emptyWorkbook = await loadWorkbook(emptyFile.buffer);
  assert.deepEqual(emptyWorkbook.worksheets.map((sheet) => sheet.name), ["종합 요약", "학교별 전체현황", "종별 참가학교"]);

  const longNameDashboard = fixtureDashboard();
  longNameDashboard.sports = [longNameDashboard.sports[0]];
  longNameDashboard.sports[0].name = `${"A".repeat(30)}'${"B".repeat(8)}`;
  const longNameFile = await createSurveyWorkbookFile(longNameDashboard, { now: exportedAt });
  const longNameWorkbook = await loadWorkbook(longNameFile.buffer);
  for (const sheet of longNameWorkbook.worksheets) {
    assert.ok(sheet.name.length <= 31);
    assert.doesNotMatch(sheet.name, /^'|'$/u);
  }
});

test("shows both export scopes and revalidates the administrator session before download", async () => {
  const [client, styles] = await Promise.all([
    readFile(new URL("app/survey-app-client.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  assert.match(client, /참가 신청 결과 내보내기/);
  assert.match(client, /선택 종목 내보내기/);
  assert.match(client, /모두 내보내기/);
  assert.match(client, /admin\/dashboard\?eventId=/);
  assert.match(client, /freshDashboard\.selectedEvent\?\.id !== selected\.id/);
  assert.match(client, /await import\("\.\/survey-workbook\.js"\)/);
  assert.match(client, /requestError\.status === 401/);
  assert.match(styles, /\.export-panel \{/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*?\.export-controls \{ display: grid; grid-template-columns: 1fr 1fr;/s);
  assert.match(styles, /@media \(max-width: 390px\)[\s\S]*?\.export-controls \{ grid-template-columns: 1fr;/s);
});
