import { SCHOOL_LEVELS, schoolLevels, schoolLevelsLabel } from "./school-levels.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const COLORS = {
  ink: "FF143643",
  teal: "FF0F766E",
  brightTeal: "FF14B8A6",
  mint: "FFDFF8F4",
  paleMint: "FFF1FAF8",
  border: "FFD9EBE8",
  white: "FFFFFFFF",
  stripe: "FFF7FAFA",
  muted: "FF6D8586",
  inactive: "FFE8ECEC",
  inactiveText: "FF667879",
  success: "FFE4F7F3",
  successText: "FF0C6C63",
  warning: "FFFFF2DC",
  warningText: "FF8A5B20",
  waiting: "FFEDF1F1",
  waitingText: "FF6D7F80",
  danger: "FFFDE9E7",
  dangerText: "FFA33A31",
};

const FONT_NAME = "맑은 고딕";
const TEAM_FORMAT = '0"팀";-0"팀";"-"';
const SCHOOL_FORMAT = '0"개교"';
const DATE_FORMAT = "yyyy-mm-dd hh:mm";
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/gu;
const INVALID_SHEET_CHARACTERS = new RegExp("[\\[\\]:*?/\\\\]", "gu");

let excelJsPromise;

async function loadExcelJs() {
  excelJsPromise ??= import("exceljs").then((module) => {
    const excelJs = module.default ?? module;
    if (typeof excelJs.Workbook !== "function") throw new Error("엑셀 생성 도구를 불러오지 못했습니다.");
    return excelJs;
  });
  return excelJsPromise;
}

export function normalizeDatabaseDate(value) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toSeoulExcelDate(value) {
  const date = value instanceof Date ? value : normalizeDatabaseDate(value);
  if (!date) return null;
  return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}

function cleanText(value) {
  const withoutXmlControls = [...String(value ?? "")].filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return !((codePoint >= 0 && codePoint <= 8) || codePoint === 11 || codePoint === 12 || (codePoint >= 14 && codePoint <= 31) || (codePoint >= 127 && codePoint <= 159));
  }).join("");
  return withoutXmlControls
    .normalize("NFC")
    .replace(BIDI_CONTROLS, "")
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

function truncateUtf16(value, maximum) {
  let result = "";
  for (const character of value) {
    if (result.length + character.length > maximum) break;
    result += character;
  }
  return result;
}

export function sanitizeFilenamePart(value, fallback = "참가신청") {
  const cleaned = cleanText(value)
    .replace(/[<>:"/\\|?*]/gu, " ")
    .replace(/[\u200B-\u200F\u2060-\u2065\uFEFF]/gu, "")
    .replace(/\s+/gu, " ")
    .replace(/^[. ]+|[. ]+$/gu, "");
  return truncateUtf16(cleaned || fallback, 56).replace(/[. ]+$/gu, "") || fallback;
}

export function makeUniqueSheetName(value, usedNames = new Set()) {
  let base = cleanText(value)
    .replace(INVALID_SHEET_CHARACTERS, " ")
    .replace(/^'+|'+$/gu, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
  if (!base) base = "결과";
  if (base.toLocaleLowerCase("en-US") === "history") base = "결과 History";
  base = truncateUtf16(base, 31).replace(/^'+|'+$/gu, "").trim() || "결과";

  let candidate = base;
  let suffixNumber = 2;
  while (usedNames.has(candidate.toLocaleLowerCase("en-US"))) {
    const suffix = ` (${suffixNumber})`;
    candidate = `${truncateUtf16(base, 31 - suffix.length)}${suffix}`;
    suffixNumber += 1;
  }
  usedNames.add(candidate.toLocaleLowerCase("en-US"));
  return candidate;
}

function formatSeoul(value, includeSeconds = false) {
  const date = value instanceof Date ? value : normalizeDatabaseDate(value);
  if (!date) return "-";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}${includeSeconds ? `:${part("second")}` : ""}`;
}

function fileTimestamp(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}${part("month")}${part("day")}_${part("hour")}${part("minute")}`;
}

function schoolLevel(value) {
  return value === "elementary" ? "elementary" : "middle";
}

function schoolLevelOrder(value) {
  return schoolLevel(value) === "elementary" ? 0 : 1;
}

function sortedSports(dashboard) {
  return [...dashboard.sports]
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map((sport) => ({
      ...sport,
      name: cleanText(sport.name) || "이름 없는 종목",
      divisions: [...sport.divisions]
        .sort((left, right) => schoolLevelOrder(left.schoolLevel) - schoolLevelOrder(right.schoolLevel)
          || left.displayOrder - right.displayOrder)
        .map((division) => ({ ...division, name: cleanText(division.name) || "이름 없는 종별" })),
    }));
}

function sortedRows(dashboard) {
  return [...dashboard.rows]
    .sort((left, right) => schoolLevelOrder(left.school.schoolLevel) - schoolLevelOrder(right.school.schoolLevel)
      || left.school.displayOrder - right.school.displayOrder)
    .map((row) => ({ ...row, school: { ...row.school, name: cleanText(row.school.name) || "이름 없는 학교" } }));
}

function selectionCount(row, sport, divisionId) {
  if (!row.submitted || row.noParticipation) return 0;
  const division = sport.divisions.find((candidate) => candidate.id === divisionId);
  if (!division || schoolLevel(division.schoolLevel) !== schoolLevel(row.school.schoolLevel)) return 0;
  const stored = Number(row.selections.find((selection) => selection.divisionId === divisionId)?.teamCount ?? 0);
  if (!Number.isFinite(stored) || stored <= 0) return 0;
  return Math.max(1, Math.floor(stored));
}

function sportTeamCount(row, sport) {
  return sport.divisions.reduce((total, division) => total + selectionCount(row, sport, division.id), 0);
}

function totalTeamCount(row, sports) {
  return sports.reduce((total, sport) => total + sportTeamCount(row, sport), 0);
}

function responseStatus(row, sports) {
  if (!row.submitted) return "미신청";
  if (row.noParticipation) return "참가 신청 없음";
  return totalTeamCount(row, sports) > 0 ? "신청 완료" : "확인 필요";
}

function sportResponseStatus(row, sport, sports) {
  if (!row.submitted) return "미신청";
  if (row.noParticipation) return "전체 참가 신청 없음";
  if (sportTeamCount(row, sport) > 0) return "참가";
  return totalTeamCount(row, sports) > 0 ? "해당 종목 미신청" : "확인 필요";
}

function buildReport(dashboard, sportId) {
  if (!dashboard.selectedEvent) throw new Error("내보낼 대회를 먼저 선택해 주세요.");
  const tournament = {
    academicYear: Number(dashboard.selectedEvent.academicYear),
    name: cleanText(dashboard.selectedEvent.name) || "학교스포츠클럽대회",
    surveyStart: dashboard.selectedEvent.surveyStart,
    surveyEnd: dashboard.selectedEvent.surveyEnd,
    status: dashboard.selectedEvent.status,
  };
  const sports = sortedSports(dashboard);
  const rows = sortedRows(dashboard);
  const eventSchoolLevels = schoolLevels(dashboard.selectedEvent.schoolLevels);
  const showSchoolLevels = eventSchoolLevels.includes("elementary")
    || rows.some((row) => row.school.schoolLevel === "elementary");
  const selectedSport = sportId ? sports.find((sport) => sport.id === sportId) : null;
  if (sportId && !selectedSport) throw new Error("선택한 종목을 이 대회에서 찾을 수 없습니다.");

  const knownDivisions = new Map(sports.flatMap((sport) => sport.divisions.map((division) => [division.id, division])));
  const unknownSelectionCount = rows.reduce((count, row) => count + row.selections.filter(
    (selection) => {
      const division = knownDivisions.get(selection.divisionId);
      return Number(selection.teamCount) > 0 && (!division
        || schoolLevel(division.schoolLevel) !== schoolLevel(row.school.schoolLevel));
    },
  ).length, 0);

  return {
    tournament,
    surveyMessage: cleanText(dashboard.surveyState?.message) || "신청 상태 정보 없음",
    sports,
    rows,
    eventSchoolLevels,
    showSchoolLevels,
    selectedSport,
    unknownSelectionCount,
  };
}

function textCell(cell, value) {
  const text = cleanText(value);
  cell.value = text || null;
  if (text) cell.numFmt = "@";
}

function numberCell(cell, value, numberFormat) {
  cell.value = Number(value) || 0;
  if (numberFormat) cell.numFmt = numberFormat;
}

function schoolOrdinalCell(cell, row, report) {
  if (report.showSchoolLevels) {
    const level = SCHOOL_LEVELS.find((option) => option.value === schoolLevel(row.school.schoolLevel));
    textCell(cell, `${level.shortLabel} ${row.school.displayOrder}`);
  } else {
    numberCell(cell, row.school.displayOrder);
  }
}

function thinBorder() {
  const side = { style: "thin", color: { argb: COLORS.border } };
  return { top: side, left: side, bottom: side, right: side };
}

function styleTitleCell(cell) {
  cell.font = { name: FONT_NAME, size: 20, bold: true, color: { argb: COLORS.white } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.ink } };
  cell.alignment = { vertical: "middle", horizontal: "left" };
}

function styleSubtitleCell(cell) {
  cell.font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.teal } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.mint } };
  cell.alignment = { vertical: "middle", horizontal: "left" };
}

function styleMetaCell(cell) {
  cell.font = { name: FONT_NAME, size: 9, color: { argb: COLORS.muted } };
  cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
}

function styleHeaderCell(cell, inactive = false) {
  cell.font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.white } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: inactive ? COLORS.inactiveText : COLORS.teal } };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  cell.border = thinBorder();
}

function styleBodyCell(cell, rowIndex, alignment = "center") {
  cell.font = { name: FONT_NAME, size: 9, color: { argb: COLORS.ink } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowIndex % 2 ? COLORS.white : COLORS.stripe } };
  cell.alignment = { vertical: "middle", horizontal: alignment, wrapText: alignment === "left" };
  cell.border = thinBorder();
}

function applyStatusStyle(cell, status) {
  const success = status === "신청 완료" || status === "참가";
  const warning = status === "참가 신청 없음" || status === "전체 참가 신청 없음" || status === "해당 종목 미신청";
  const danger = status === "확인 필요";
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: success ? COLORS.success : warning ? COLORS.warning : danger ? COLORS.danger : COLORS.waiting },
  };
  cell.font = {
    name: FONT_NAME,
    size: 9,
    bold: true,
    color: { argb: success ? COLORS.successText : warning ? COLORS.warningText : danger ? COLORS.dangerText : COLORS.waitingText },
  };
}

function columnLetter(number) {
  let value = number;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function mergeAndWrite(sheet, startRow, startColumn, endRow, endColumn, value, style) {
  sheet.mergeCells(startRow, startColumn, endRow, endColumn);
  const cell = sheet.getCell(startRow, startColumn);
  textCell(cell, value);
  style(cell);
  return cell;
}

function setupSheet(sheet, lastColumn, paperSize = 9) {
  sheet.views = [{ showGridLines: false }];
  sheet.properties.defaultRowHeight = 22;
  sheet.pageSetup = {
    orientation: "landscape",
    paperSize,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
  };
  sheet.headerFooter = {
    oddHeader: "&L동부교육지원청 학교스포츠클럽&C참가 신청 결과",
    oddFooter: "&L동부교육지원청&C페이지 &P / &N&R운영자용",
  };
  for (let column = 1; column <= lastColumn; column += 1) sheet.getColumn(column).width = 13;
}

function addDocumentHeader(sheet, report, lastColumn, title, scope, now) {
  mergeAndWrite(sheet, 1, 1, 1, lastColumn, title, styleTitleCell);
  mergeAndWrite(
    sheet,
    2,
    1,
    2,
    lastColumn,
    `${report.tournament.academicYear}학년도 · ${report.tournament.name} · ${scope}${report.showSchoolLevels ? ` · ${schoolLevelsLabel(report.eventSchoolLevels)}` : ""}`,
    styleSubtitleCell,
  );
  mergeAndWrite(
    sheet,
    3,
    1,
    3,
    lastColumn,
    `신청 기간  ${formatSeoul(report.tournament.surveyStart)} ~ ${formatSeoul(report.tournament.surveyEnd)}   |   내보낸 시각  ${formatSeoul(now, true)}`,
    styleMetaCell,
  );
  sheet.getRow(1).height = 38;
  sheet.getRow(2).height = 25;
  sheet.getRow(3).height = 24;
}

function addMetricCard(sheet, labelRow, startColumn, endColumn, label, value, numberFormat, valueColor = COLORS.teal) {
  sheet.mergeCells(labelRow, startColumn, labelRow, endColumn);
  sheet.mergeCells(labelRow + 1, startColumn, labelRow + 1, endColumn);
  const labelCell = sheet.getCell(labelRow, startColumn);
  textCell(labelCell, label);
  labelCell.font = { name: FONT_NAME, size: 9, bold: true, color: { argb: COLORS.muted } };
  labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.paleMint } };
  labelCell.alignment = { vertical: "middle", horizontal: "center" };
  labelCell.border = thinBorder();
  const valueCell = sheet.getCell(labelRow + 1, startColumn);
  numberCell(valueCell, value, numberFormat);
  valueCell.font = { name: FONT_NAME, size: 18, bold: true, color: { argb: valueColor } };
  valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.white } };
  valueCell.alignment = { vertical: "middle", horizontal: "center" };
  valueCell.border = thinBorder();
  sheet.getRow(labelRow).height = 22;
  sheet.getRow(labelRow + 1).height = 32;
}

function summaryMetrics(report) {
  const responded = report.rows.filter((row) => row.submitted);
  const participationRows = responded.filter((row) => !row.noParticipation && totalTeamCount(row, report.sports) > 0);
  return {
    schoolCount: report.rows.length,
    respondedCount: responded.length,
    waitingCount: report.rows.length - responded.length,
    responseRate: report.rows.length ? responded.length / report.rows.length : 0,
    participatingSchoolCount: participationRows.length,
    noParticipationCount: responded.filter((row) => row.noParticipation).length,
    totalTeams: participationRows.reduce((total, row) => total + totalTeamCount(row, report.sports), 0),
  };
}

function addOverallSummary(workbook, report, usedNames, now) {
  const sheet = workbook.addWorksheet(makeUniqueSheetName("종합 요약", usedNames));
  setupSheet(sheet, 8);
  addDocumentHeader(sheet, report, 8, "학교스포츠클럽 참가 신청 결과", "모든 종목", now);
  const metrics = summaryMetrics(report);
  addMetricCard(sheet, 5, 1, 2, "전체 대상 학교", metrics.schoolCount, SCHOOL_FORMAT);
  addMetricCard(sheet, 5, 3, 4, "신청 완료", metrics.respondedCount, SCHOOL_FORMAT);
  addMetricCard(sheet, 5, 5, 6, "미신청", metrics.waitingCount, SCHOOL_FORMAT, COLORS.warningText);
  addMetricCard(sheet, 5, 7, 8, "신청률", metrics.responseRate, "0%", COLORS.brightTeal);
  addMetricCard(sheet, 8, 1, 2, "참가 신청 학교", metrics.participatingSchoolCount, SCHOOL_FORMAT);
  addMetricCard(sheet, 8, 3, 4, "참가 신청 없음", metrics.noParticipationCount, SCHOOL_FORMAT, COLORS.warningText);
  addMetricCard(sheet, 8, 5, 6, "전체 신청 팀", metrics.totalTeams, TEAM_FORMAT);
  addMetricCard(sheet, 8, 7, 8, "데이터 확인 필요", report.unknownSelectionCount, '0"건"', report.unknownSelectionCount ? COLORS.dangerText : COLORS.teal);

  const tableRow = 12;
  const headers = ["종목", "구분", "상태", "참가 학교", "신청 팀", "학교 전체 최대", "한 종별 최대", "비고"];
  headers.forEach((header, index) => {
    const cell = sheet.getCell(tableRow, index + 1);
    textCell(cell, header);
    styleHeaderCell(cell);
  });
  sheet.getRow(tableRow).height = 30;
  let rowNumber = tableRow + 1;
  for (const sport of report.sports) {
    const participantRows = report.rows.filter((row) => sportTeamCount(row, sport) > 0);
    const values = [
      sport.name,
      "종목 합계",
      sport.active ? "활성" : "비활성",
      participantRows.length,
      participantRows.reduce((total, row) => total + sportTeamCount(row, sport), 0),
      sport.maxTeamsPerSchool,
      sport.maxTeamsPerDivision,
      sport.active ? "" : "과거 신청 보존",
    ];
    values.forEach((value, index) => {
      const cell = sheet.getCell(rowNumber, index + 1);
      if (index === 3) numberCell(cell, value, SCHOOL_FORMAT);
      else if (index === 4 || index === 5 || index === 6) numberCell(cell, value, index === 4 ? TEAM_FORMAT : '0"팀"');
      else textCell(cell, value);
      styleBodyCell(cell, rowNumber, index < 3 || index > 6 ? "left" : "center");
      cell.font = { ...cell.font, bold: true, color: { argb: sport.active ? COLORS.ink : COLORS.inactiveText } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sport.active ? COLORS.mint : COLORS.inactive } };
    });
    rowNumber += 1;
    for (const division of sport.divisions) {
      const participants = report.rows.filter((row) => selectionCount(row, sport, division.id) > 0);
      const divisionValues = [
        "",
        `↳ ${division.name}`,
        division.active ? "활성" : "비활성",
        participants.length,
        participants.reduce((total, row) => total + selectionCount(row, sport, division.id), 0),
        "",
        "",
        division.active ? "" : "과거 신청 보존",
      ];
      divisionValues.forEach((value, index) => {
        const cell = sheet.getCell(rowNumber, index + 1);
        if (index === 3) numberCell(cell, value, SCHOOL_FORMAT);
        else if (index === 4) numberCell(cell, value, TEAM_FORMAT);
        else textCell(cell, value);
        styleBodyCell(cell, rowNumber, index < 3 || index > 4 ? "left" : "center");
        if (!division.active) cell.font = { ...cell.font, color: { argb: COLORS.inactiveText } };
      });
      rowNumber += 1;
    }
  }
  if (!report.sports.length) {
    mergeAndWrite(sheet, rowNumber, 1, rowNumber, 8, "등록된 종목이 없습니다.", (cell) => {
      styleBodyCell(cell, rowNumber, "center");
      cell.font = { ...cell.font, color: { argb: COLORS.muted } };
    });
    rowNumber += 1;
  }
  sheet.autoFilter = { from: { row: tableRow, column: 1 }, to: { row: Math.max(tableRow, rowNumber - 1), column: 8 } };
  sheet.views = [{ state: "frozen", ySplit: 3, topLeftCell: "A4", showGridLines: false }];
  sheet.pageSetup.printTitlesRow = "1:12";
  [19, 20, 12, 14, 13, 17, 14, 20].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
}

function addSchoolOverview(workbook, report, usedNames, now) {
  const sportColumns = report.sports.map((sport) => ({ sport, count: sport.divisions.length + 1 }));
  const lastColumn = 6 + sportColumns.reduce((total, item) => total + item.count, 0);
  const sheet = workbook.addWorksheet(makeUniqueSheetName("학교별 전체현황", usedNames));
  setupSheet(sheet, lastColumn, 8);
  addDocumentHeader(sheet, report, lastColumn, "학교별 참가 신청 전체현황", "모든 종목", now);

  const baseHeaders = [report.showSchoolLevels ? "학교급 · 순번" : "순번", "학교명", "신청 상태", "참가 종목 수", "총 신청 팀"];
  baseHeaders.forEach((header, index) => {
    sheet.mergeCells(4, index + 1, 5, index + 1);
    const cell = sheet.getCell(4, index + 1);
    textCell(cell, header);
    styleHeaderCell(cell);
  });
  let currentColumn = 6;
  for (const { sport } of sportColumns) {
    const startColumn = currentColumn;
    const endColumn = currentColumn + sport.divisions.length;
    sheet.mergeCells(4, startColumn, 4, endColumn);
    const groupCell = sheet.getCell(4, startColumn);
    textCell(groupCell, `${sport.name}${sport.active ? "" : " (비활성)"}`);
    styleHeaderCell(groupCell, !sport.active);
    for (const division of sport.divisions) {
      const cell = sheet.getCell(5, currentColumn);
      textCell(cell, `${division.name}${division.active ? "" : " (비활성)"}`);
      styleHeaderCell(cell, !division.active);
      currentColumn += 1;
    }
    const totalCell = sheet.getCell(5, currentColumn);
    textCell(totalCell, "종목 합계");
    styleHeaderCell(totalCell, !sport.active);
    currentColumn += 1;
  }
  sheet.mergeCells(4, lastColumn, 5, lastColumn);
  textCell(sheet.getCell(4, lastColumn), "마지막 저장");
  styleHeaderCell(sheet.getCell(4, lastColumn));
  sheet.getRow(4).height = 29;
  sheet.getRow(5).height = 34;

  let rowNumber = 6;
  for (const row of report.rows) {
    const status = responseStatus(row, report.sports);
    const participatingSportCount = report.sports.filter((sport) => sportTeamCount(row, sport) > 0).length;
    const values = [row.school.displayOrder, row.school.name, status, row.submitted ? participatingSportCount : null, row.submitted ? totalTeamCount(row, report.sports) : null];
    values.forEach((value, index) => {
      const cell = sheet.getCell(rowNumber, index + 1);
      if (index === 0) schoolOrdinalCell(cell, row, report);
      else if (index >= 3 && value !== null) numberCell(cell, value, index === 4 ? TEAM_FORMAT : undefined);
      else if (value !== null) textCell(cell, value);
      styleBodyCell(cell, rowNumber, index === 1 ? "left" : "center");
      if (index === 2) applyStatusStyle(cell, status);
    });
    currentColumn = 6;
    for (const sport of report.sports) {
      for (const division of sport.divisions) {
        const cell = sheet.getCell(rowNumber, currentColumn);
        if (row.submitted) numberCell(cell, selectionCount(row, sport, division.id), TEAM_FORMAT);
        styleBodyCell(cell, rowNumber);
        if (!division.active) cell.font = { ...cell.font, color: { argb: COLORS.inactiveText } };
        currentColumn += 1;
      }
      const cell = sheet.getCell(rowNumber, currentColumn);
      if (row.submitted) numberCell(cell, sportTeamCount(row, sport), TEAM_FORMAT);
      styleBodyCell(cell, rowNumber);
      cell.font = { ...cell.font, bold: true, color: { argb: sport.active ? COLORS.teal : COLORS.inactiveText } };
      currentColumn += 1;
    }
    const updatedCell = sheet.getCell(rowNumber, lastColumn);
    const updatedDate = toSeoulExcelDate(row.updatedAt);
    if (updatedDate) {
      updatedCell.value = updatedDate;
      updatedCell.numFmt = DATE_FORMAT;
    }
    styleBodyCell(updatedCell, rowNumber);
    sheet.getRow(rowNumber).height = 24;
    rowNumber += 1;
  }

  sheet.mergeCells(rowNumber, 1, rowNumber, 2);
  textCell(sheet.getCell(rowNumber, 1), "전체 합계");
  const totalValues = [
    report.rows.filter((row) => row.submitted).length,
    report.rows.reduce((total, row) => total + report.sports.filter((sport) => sportTeamCount(row, sport) > 0).length, 0),
    report.rows.reduce((total, row) => total + totalTeamCount(row, report.sports), 0),
  ];
  textCell(sheet.getCell(rowNumber, 3), `${totalValues[0]}개교 신청`);
  numberCell(sheet.getCell(rowNumber, 4), totalValues[1]);
  numberCell(sheet.getCell(rowNumber, 5), totalValues[2], TEAM_FORMAT);
  currentColumn = 6;
  for (const sport of report.sports) {
    for (const division of sport.divisions) {
      numberCell(
        sheet.getCell(rowNumber, currentColumn),
        report.rows.reduce((total, row) => total + selectionCount(row, sport, division.id), 0),
        TEAM_FORMAT,
      );
      currentColumn += 1;
    }
    numberCell(
      sheet.getCell(rowNumber, currentColumn),
      report.rows.reduce((total, row) => total + sportTeamCount(row, sport), 0),
      TEAM_FORMAT,
    );
    currentColumn += 1;
  }
  for (let column = 1; column <= lastColumn; column += 1) {
    const cell = sheet.getCell(rowNumber, column);
    cell.font = { name: FONT_NAME, size: 9, bold: true, color: { argb: COLORS.teal } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.mint } };
    cell.alignment = { vertical: "middle", horizontal: column === 1 ? "left" : "center" };
    cell.border = thinBorder();
  }
  sheet.getRow(rowNumber).height = 27;

  sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(5, rowNumber - 1), column: lastColumn } };
  sheet.views = [{ state: "frozen", ySplit: 5, topLeftCell: "A6", showGridLines: false }];
  sheet.pageSetup.printTitlesRow = "1:5";
  [report.showSchoolLevels ? 15 : 7, 23, 15, 13, 13].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  for (let column = 6; column < lastColumn; column += 1) sheet.getColumn(column).width = 13;
  sheet.getColumn(lastColumn).width = 19;
}

function participatingRowsForSport(report, sport) {
  return report.rows.filter((row) => sportTeamCount(row, sport) > 0);
}

function addSportParticipants(workbook, report, sport, usedNames, now) {
  const tableColumnCount = Math.max(8, sport.divisions.length + 4);
  const sheet = workbook.addWorksheet(makeUniqueSheetName(`${sport.name} 참가학교`, usedNames));
  setupSheet(sheet, tableColumnCount);
  addDocumentHeader(
    sheet,
    report,
    tableColumnCount,
    `${sport.name} 참가학교 명단${sport.active ? "" : " · 비활성 종목"}`,
    sport.name,
    now,
  );
  const participatingRows = participatingRowsForSport(report, sport);
  const teams = participatingRows.reduce((total, row) => total + sportTeamCount(row, sport), 0);
  addMetricCard(sheet, 5, 1, 2, "참가 학교", participatingRows.length, SCHOOL_FORMAT);
  addMetricCard(sheet, 5, 3, 4, "신청 팀", teams, TEAM_FORMAT);
  addMetricCard(sheet, 5, 5, 6, "학교 전체 최대", sport.maxTeamsPerSchool, '0"팀"', sport.active ? COLORS.teal : COLORS.inactiveText);
  addMetricCard(sheet, 5, 7, 8, "한 종별 최대", sport.maxTeamsPerDivision, '0"팀"', sport.active ? COLORS.teal : COLORS.inactiveText);

  const tableRow = 9;
  const headers = [report.showSchoolLevels ? "학교급 · 순번" : "순번", "학교명", ...sport.divisions.map((division) => `${division.name}${division.active ? "" : " (비활성)"}`), "종목 합계", "마지막 저장"];
  headers.forEach((header, index) => {
    const cell = sheet.getCell(tableRow, index + 1);
    textCell(cell, header);
    styleHeaderCell(cell, index >= 2 && index < 2 + sport.divisions.length && !sport.divisions[index - 2].active);
  });
  sheet.getRow(tableRow).height = 34;
  let rowNumber = tableRow + 1;
  for (const row of participatingRows) {
    schoolOrdinalCell(sheet.getCell(rowNumber, 1), row, report);
    textCell(sheet.getCell(rowNumber, 2), row.school.name);
    styleBodyCell(sheet.getCell(rowNumber, 1), rowNumber);
    styleBodyCell(sheet.getCell(rowNumber, 2), rowNumber, "left");
    let column = 3;
    for (const division of sport.divisions) {
      numberCell(sheet.getCell(rowNumber, column), selectionCount(row, sport, division.id), TEAM_FORMAT);
      styleBodyCell(sheet.getCell(rowNumber, column), rowNumber);
      if (!division.active) sheet.getCell(rowNumber, column).font = { ...sheet.getCell(rowNumber, column).font, color: { argb: COLORS.inactiveText } };
      column += 1;
    }
    numberCell(sheet.getCell(rowNumber, column), sportTeamCount(row, sport), TEAM_FORMAT);
    styleBodyCell(sheet.getCell(rowNumber, column), rowNumber);
    sheet.getCell(rowNumber, column).font = { ...sheet.getCell(rowNumber, column).font, bold: true, color: { argb: COLORS.teal } };
    column += 1;
    const updatedDate = toSeoulExcelDate(row.updatedAt);
    if (updatedDate) {
      sheet.getCell(rowNumber, column).value = updatedDate;
      sheet.getCell(rowNumber, column).numFmt = DATE_FORMAT;
    }
    styleBodyCell(sheet.getCell(rowNumber, column), rowNumber);
    sheet.getRow(rowNumber).height = 24;
    rowNumber += 1;
  }
  if (!participatingRows.length) {
    mergeAndWrite(sheet, rowNumber, 1, rowNumber, headers.length, "현재 신청한 학교가 없습니다.", (cell) => {
      styleBodyCell(cell, rowNumber, "center");
      cell.font = { ...cell.font, color: { argb: COLORS.muted } };
    });
    sheet.getRow(rowNumber).height = 35;
    rowNumber += 1;
  } else {
    sheet.mergeCells(rowNumber, 1, rowNumber, 2);
    textCell(sheet.getCell(rowNumber, 1), "합계");
    let column = 3;
    for (const division of sport.divisions) {
      numberCell(
        sheet.getCell(rowNumber, column),
        participatingRows.reduce((total, row) => total + selectionCount(row, sport, division.id), 0),
        TEAM_FORMAT,
      );
      column += 1;
    }
    numberCell(sheet.getCell(rowNumber, column), teams, TEAM_FORMAT);
    for (let index = 1; index <= headers.length; index += 1) {
      const cell = sheet.getCell(rowNumber, index);
      cell.font = { name: FONT_NAME, size: 9, bold: true, color: { argb: COLORS.teal } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.mint } };
      cell.alignment = { vertical: "middle", horizontal: index === 1 ? "left" : "center" };
      cell.border = thinBorder();
    }
  }
  sheet.autoFilter = { from: { row: tableRow, column: 1 }, to: { row: Math.max(tableRow, rowNumber - 1), column: headers.length } };
  sheet.views = [{ state: "frozen", ySplit: tableRow, topLeftCell: `A${tableRow + 1}`, showGridLines: false }];
  sheet.pageSetup.printTitlesRow = `1:${tableRow}`;
  sheet.getColumn(1).width = report.showSchoolLevels ? 15 : 8;
  sheet.getColumn(2).width = 24;
  for (let column = 3; column < headers.length; column += 1) sheet.getColumn(column).width = 14;
  sheet.getColumn(headers.length).width = 19;
}

function addDivisionParticipants(workbook, report, usedNames, now) {
  const sheet = workbook.addWorksheet(makeUniqueSheetName("종별 참가학교", usedNames));
  setupSheet(sheet, 6);
  addDocumentHeader(sheet, report, 6, "종별 참가학교 전체 명단", "모든 종목", now);
  const headers = ["종목", "종별", report.showSchoolLevels ? "학교급 · 순번" : "순번", "학교명", "신청 팀", "마지막 저장"];
  headers.forEach((header, index) => {
    textCell(sheet.getCell(5, index + 1), header);
    styleHeaderCell(sheet.getCell(5, index + 1));
  });
  sheet.getRow(5).height = 32;
  let rowNumber = 6;
  for (const sport of report.sports) {
    for (const division of sport.divisions) {
      for (const row of report.rows.filter((candidate) => selectionCount(candidate, sport, division.id) > 0)) {
        const values = [
          `${sport.name}${sport.active ? "" : " (비활성)"}`,
          `${division.name}${division.active ? "" : " (비활성)"}`,
          row.school.displayOrder,
          row.school.name,
          selectionCount(row, sport, division.id),
        ];
        values.forEach((value, index) => {
          const cell = sheet.getCell(rowNumber, index + 1);
          if (index === 2) schoolOrdinalCell(cell, row, report);
          else if (index === 4) numberCell(cell, value, TEAM_FORMAT);
          else textCell(cell, value);
          styleBodyCell(cell, rowNumber, index === 0 || index === 1 || index === 3 ? "left" : "center");
        });
        const updatedDate = toSeoulExcelDate(row.updatedAt);
        if (updatedDate) {
          sheet.getCell(rowNumber, 6).value = updatedDate;
          sheet.getCell(rowNumber, 6).numFmt = DATE_FORMAT;
        }
        styleBodyCell(sheet.getCell(rowNumber, 6), rowNumber);
        rowNumber += 1;
      }
    }
  }
  if (rowNumber === 6) {
    mergeAndWrite(sheet, rowNumber, 1, rowNumber, 6, "현재 신청한 학교가 없습니다.", (cell) => styleBodyCell(cell, rowNumber, "center"));
    rowNumber += 1;
  }
  sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(5, rowNumber - 1), column: 6 } };
  sheet.views = [{ state: "frozen", ySplit: 5, topLeftCell: "A6", showGridLines: false }];
  sheet.pageSetup.printTitlesRow = "1:5";
  [20, 18, report.showSchoolLevels ? 15 : 8, 24, 13, 19].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
}

function addSportSummary(workbook, report, sport, usedNames, now) {
  const sheet = workbook.addWorksheet(makeUniqueSheetName("종목 요약", usedNames));
  setupSheet(sheet, 8);
  addDocumentHeader(sheet, report, 8, `${sport.name} 참가 신청 요약`, sport.name, now);
  const metrics = summaryMetrics(report);
  const participants = participatingRowsForSport(report, sport);
  const teams = participants.reduce((total, row) => total + sportTeamCount(row, sport), 0);
  addMetricCard(sheet, 5, 1, 2, "전체 대상 학교", metrics.schoolCount, SCHOOL_FORMAT);
  addMetricCard(sheet, 5, 3, 4, "전체 신청 완료", metrics.respondedCount, SCHOOL_FORMAT);
  addMetricCard(sheet, 5, 5, 6, "종목 참가 학교", participants.length, SCHOOL_FORMAT);
  addMetricCard(sheet, 5, 7, 8, "종목 신청 팀", teams, TEAM_FORMAT);
  addMetricCard(sheet, 8, 1, 2, "미신청", metrics.waitingCount, SCHOOL_FORMAT, COLORS.warningText);
  addMetricCard(sheet, 8, 3, 4, "전체 참가 신청 없음", metrics.noParticipationCount, SCHOOL_FORMAT, COLORS.warningText);
  addMetricCard(sheet, 8, 5, 6, "학교 전체 최대", sport.maxTeamsPerSchool, '0"팀"');
  addMetricCard(sheet, 8, 7, 8, "한 종별 최대", sport.maxTeamsPerDivision, '0"팀"');

  const headers = ["종별", "상태", "참가 학교", "신청 팀"];
  headers.forEach((header, index) => {
    const startColumn = index * 2 + 1;
    sheet.mergeCells(12, startColumn, 12, startColumn + 1);
    textCell(sheet.getCell(12, startColumn), header);
    styleHeaderCell(sheet.getCell(12, startColumn));
  });
  let rowNumber = 13;
  for (const division of sport.divisions) {
    const divisionParticipants = report.rows.filter((row) => selectionCount(row, sport, division.id) > 0);
    const values = [
      division.name,
      division.active ? "활성" : "비활성",
      divisionParticipants.length,
      divisionParticipants.reduce((total, row) => total + selectionCount(row, sport, division.id), 0),
    ];
    values.forEach((value, index) => {
      const startColumn = index * 2 + 1;
      sheet.mergeCells(rowNumber, startColumn, rowNumber, startColumn + 1);
      const cell = sheet.getCell(rowNumber, startColumn);
      if (index === 2) numberCell(cell, value, SCHOOL_FORMAT);
      else if (index === 3) numberCell(cell, value, TEAM_FORMAT);
      else textCell(cell, value);
      styleBodyCell(cell, rowNumber, index < 2 ? "left" : "center");
      if (!division.active) cell.font = { ...cell.font, color: { argb: COLORS.inactiveText } };
    });
    rowNumber += 1;
  }
  if (!sport.divisions.length) {
    mergeAndWrite(sheet, rowNumber, 1, rowNumber, 8, "등록된 종별이 없습니다.", (cell) => styleBodyCell(cell, rowNumber, "center"));
  }
  sheet.views = [{ state: "frozen", ySplit: 3, topLeftCell: "A4", showGridLines: false }];
  sheet.pageSetup.printTitlesRow = "1:12";
  for (let column = 1; column <= 8; column += 1) sheet.getColumn(column).width = 15;
}

function addAllSchoolsForSport(workbook, report, sport, usedNames, now) {
  const lastColumn = sport.divisions.length + 7;
  const sheet = workbook.addWorksheet(makeUniqueSheetName("전체학교 확인", usedNames));
  setupSheet(sheet, lastColumn);
  addDocumentHeader(sheet, report, lastColumn, `${sport.name} 전체학교 확인`, sport.name, now);
  const participants = participatingRowsForSport(report, sport);
  const totalTeams = participants.reduce((total, row) => total + sportTeamCount(row, sport), 0);
  addMetricCard(sheet, 5, 1, 2, "종목 참가 학교", participants.length, SCHOOL_FORMAT);
  addMetricCard(sheet, 5, 3, 4, "종목 신청 팀", totalTeams, TEAM_FORMAT);
  addMetricCard(sheet, 5, 5, 6, "미신청", report.rows.filter((row) => !row.submitted).length, SCHOOL_FORMAT, COLORS.warningText);

  const tableRow = 9;
  const headers = [
    report.showSchoolLevels ? "학교급 · 순번" : "순번",
    "학교명",
    "종목 신청 상태",
    ...sport.divisions.map((division) => `${division.name}${division.active ? "" : " (비활성)"}`),
    "종목 합계",
    "전체 신청 상태",
    "마지막 저장",
  ];
  headers.forEach((header, index) => {
    textCell(sheet.getCell(tableRow, index + 1), header);
    const division = index >= 3 && index < 3 + sport.divisions.length ? sport.divisions[index - 3] : null;
    styleHeaderCell(sheet.getCell(tableRow, index + 1), Boolean(division && !division.active));
  });
  sheet.getRow(tableRow).height = 34;
  let rowNumber = tableRow + 1;
  for (const row of report.rows) {
    const sportStatus = sportResponseStatus(row, sport, report.sports);
    const overallStatus = responseStatus(row, report.sports);
    schoolOrdinalCell(sheet.getCell(rowNumber, 1), row, report);
    textCell(sheet.getCell(rowNumber, 2), row.school.name);
    textCell(sheet.getCell(rowNumber, 3), sportStatus);
    styleBodyCell(sheet.getCell(rowNumber, 1), rowNumber);
    styleBodyCell(sheet.getCell(rowNumber, 2), rowNumber, "left");
    styleBodyCell(sheet.getCell(rowNumber, 3), rowNumber);
    applyStatusStyle(sheet.getCell(rowNumber, 3), sportStatus);
    let column = 4;
    for (const division of sport.divisions) {
      if (row.submitted) numberCell(sheet.getCell(rowNumber, column), selectionCount(row, sport, division.id), TEAM_FORMAT);
      styleBodyCell(sheet.getCell(rowNumber, column), rowNumber);
      if (!division.active) sheet.getCell(rowNumber, column).font = { ...sheet.getCell(rowNumber, column).font, color: { argb: COLORS.inactiveText } };
      column += 1;
    }
    if (row.submitted) numberCell(sheet.getCell(rowNumber, column), sportTeamCount(row, sport), TEAM_FORMAT);
    styleBodyCell(sheet.getCell(rowNumber, column), rowNumber);
    sheet.getCell(rowNumber, column).font = { ...sheet.getCell(rowNumber, column).font, bold: true, color: { argb: COLORS.teal } };
    column += 1;
    textCell(sheet.getCell(rowNumber, column), overallStatus);
    styleBodyCell(sheet.getCell(rowNumber, column), rowNumber);
    applyStatusStyle(sheet.getCell(rowNumber, column), overallStatus);
    column += 1;
    const updatedDate = toSeoulExcelDate(row.updatedAt);
    if (updatedDate) {
      sheet.getCell(rowNumber, column).value = updatedDate;
      sheet.getCell(rowNumber, column).numFmt = DATE_FORMAT;
    }
    styleBodyCell(sheet.getCell(rowNumber, column), rowNumber);
    rowNumber += 1;
  }
  sheet.autoFilter = { from: { row: tableRow, column: 1 }, to: { row: Math.max(tableRow, rowNumber - 1), column: headers.length } };
  sheet.views = [{ state: "frozen", ySplit: tableRow, topLeftCell: `A${tableRow + 1}`, showGridLines: false }];
  sheet.pageSetup.printTitlesRow = `1:${tableRow}`;
  [report.showSchoolLevels ? 15 : 8, 24, 19].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  for (let column = 4; column < headers.length - 1; column += 1) sheet.getColumn(column).width = 14;
  sheet.getColumn(headers.length - 1).width = 16;
  sheet.getColumn(headers.length).width = 19;
}

function buildFilename(report, sport, now) {
  const year = Number.isFinite(report.tournament.academicYear) ? String(report.tournament.academicYear) : "학년도";
  const tournament = sanitizeFilenamePart(report.tournament.name, "학교스포츠클럽대회").replace(/\s+/gu, "_");
  const scope = sport ? sanitizeFilenamePart(sport.name, "종목").replace(/\s+/gu, "_") : "전체";
  return `${year}_${tournament}_참가신청결과_${scope}_${fileTimestamp(now)}.xlsx`;
}

export async function createSurveyWorkbookFile(dashboard, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const report = buildReport(dashboard, options.sportId);
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "동부교육지원청";
  workbook.lastModifiedBy = "동부교육지원청";
  workbook.created = now;
  workbook.modified = now;
  workbook.title = `${report.tournament.academicYear}학년도 ${report.tournament.name} 참가 신청 결과`;
  workbook.subject = report.selectedSport ? `${report.selectedSport.name} 종목 결과` : "모든 종목 결과";
  workbook.company = "동부교육지원청";
  workbook.calcProperties.fullCalcOnLoad = false;

  const usedNames = new Set();
  if (report.selectedSport) {
    addSportSummary(workbook, report, report.selectedSport, usedNames, now);
    addSportParticipants(workbook, report, report.selectedSport, usedNames, now);
    addAllSchoolsForSport(workbook, report, report.selectedSport, usedNames, now);
  } else {
    addOverallSummary(workbook, report, usedNames, now);
    addSchoolOverview(workbook, report, usedNames, now);
    for (const sport of report.sports) addSportParticipants(workbook, report, sport, usedNames, now);
    addDivisionParticipants(workbook, report, usedNames, now);
  }

  const rawBuffer = await workbook.xlsx.writeBuffer();
  const buffer = rawBuffer instanceof Uint8Array ? rawBuffer : new Uint8Array(rawBuffer);
  return {
    buffer,
    filename: buildFilename(report, report.selectedSport, now),
    mimeType: XLSX_MIME,
    workbook,
  };
}

export async function downloadSurveyWorkbook(dashboard, options = {}) {
  const file = await createSurveyWorkbookFile(dashboard, options);
  const blob = new Blob([file.buffer], { type: file.mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = file.filename;
  link.rel = "noopener";
  document.body.append(link);
  try {
    link.click();
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  } finally {
    link.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  return file.filename;
}

export const workbookInternals = {
  cleanText,
  selectionCount,
  sportTeamCount,
  totalTeamCount,
  responseStatus,
  sportResponseStatus,
  buildFilename,
  columnLetter,
};
