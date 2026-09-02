import assert from "node:assert/strict";
import test from "node:test";
import { validateTeamLimitConfiguration, validateTeamSelection } from "../worker/team-limits.js";

test("distinguishes school-wide and per-division team limits", () => {
  const basketball = validateTeamLimitConfiguration(2, 1);
  assert.deepEqual(basketball.value, {
    maxTeamsPerSchool: 2,
    maxTeamsPerDivision: 1,
    teamCountEnabled: false,
  });

  const volleyball = validateTeamLimitConfiguration(2, 2);
  assert.deepEqual(volleyball.value, {
    maxTeamsPerSchool: 2,
    maxTeamsPerDivision: 2,
    teamCountEnabled: true,
  });
});

test("allows one team in each 3x3 division but rejects two in one division", () => {
  const male = validateTeamSelection({
    sportName: "3x3 농구",
    divisionName: "남중부",
    requestedCount: 1,
    currentSportTotal: 0,
    maxTeamsPerSchool: 2,
    maxTeamsPerDivision: 1,
  });
  assert.equal(male.value.teamCount, 1);
  assert.equal(male.value.sportTotal, 1);

  const female = validateTeamSelection({
    sportName: "3x3 농구",
    divisionName: "여중부",
    requestedCount: 1,
    currentSportTotal: male.value.sportTotal,
    maxTeamsPerSchool: 2,
    maxTeamsPerDivision: 1,
  });
  assert.equal(female.value.sportTotal, 2);

  const sameDivisionTwoTeams = validateTeamSelection({
    sportName: "3x3 농구",
    divisionName: "남중부",
    requestedCount: 2,
    currentSportTotal: 0,
    maxTeamsPerSchool: 2,
    maxTeamsPerDivision: 1,
  });
  assert.equal(sameDivisionTwoTeams.error.code, "DIVISION_TEAM_LIMIT_EXCEEDED");
  assert.match(sameDivisionTwoTeams.error.message, /남중부.*최대 1팀/u);
});

test("allows two volleyball teams in one division while enforcing the school total", () => {
  const maleTwoTeams = validateTeamSelection({
    sportName: "배구",
    divisionName: "남중부",
    requestedCount: 2,
    currentSportTotal: 0,
    maxTeamsPerSchool: 2,
    maxTeamsPerDivision: 2,
  });
  assert.equal(maleTwoTeams.value.teamCount, 2);
  assert.equal(maleTwoTeams.value.sportTotal, 2);

  const maleAndFemale = validateTeamSelection({
    sportName: "배구",
    divisionName: "여중부",
    requestedCount: 1,
    currentSportTotal: 1,
    maxTeamsPerSchool: 2,
    maxTeamsPerDivision: 2,
  });
  assert.equal(maleAndFemale.value.sportTotal, 2);

  const totalExceeded = validateTeamSelection({
    sportName: "배구",
    divisionName: "여중부",
    requestedCount: 1,
    currentSportTotal: 2,
    maxTeamsPerSchool: 2,
    maxTeamsPerDivision: 2,
  });
  assert.equal(totalExceeded.error.code, "SCHOOL_TEAM_LIMIT_EXCEEDED");
});

test("rejects invalid administrator team-limit combinations", () => {
  assert.equal(validateTeamLimitConfiguration(0, 1).error.code, "INVALID_SCHOOL_TEAM_LIMIT");
  assert.equal(validateTeamLimitConfiguration(2, 0).error.code, "INVALID_DIVISION_TEAM_LIMIT");
  assert.equal(validateTeamLimitConfiguration(2, 3).error.code, "DIVISION_LIMIT_EXCEEDS_SCHOOL_LIMIT");
  assert.equal(validateTeamLimitConfiguration(2.5, 1).error.code, "INVALID_SCHOOL_TEAM_LIMIT");
  assert.equal(validateTeamLimitConfiguration(2, 1.5).error.code, "INVALID_DIVISION_TEAM_LIMIT");
  assert.equal(validateTeamLimitConfiguration(21, 1).error.code, "INVALID_SCHOOL_TEAM_LIMIT");
});
