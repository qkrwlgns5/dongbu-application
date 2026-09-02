export const MAX_TEAM_LIMIT = 20;

export function validateTeamLimitConfiguration(maxTeamsPerSchoolValue, maxTeamsPerDivisionValue) {
  const maxTeamsPerSchool = Number(maxTeamsPerSchoolValue);
  const maxTeamsPerDivision = Number(maxTeamsPerDivisionValue);

  if (!Number.isInteger(maxTeamsPerSchool) || maxTeamsPerSchool < 1 || maxTeamsPerSchool > MAX_TEAM_LIMIT) {
    return { error: { code: "INVALID_SCHOOL_TEAM_LIMIT", message: `학교 전체 최대 팀 수는 1~${MAX_TEAM_LIMIT} 사이로 입력해 주세요.` } };
  }
  if (!Number.isInteger(maxTeamsPerDivision) || maxTeamsPerDivision < 1 || maxTeamsPerDivision > MAX_TEAM_LIMIT) {
    return { error: { code: "INVALID_DIVISION_TEAM_LIMIT", message: `한 종별 최대 팀 수는 1~${MAX_TEAM_LIMIT} 사이로 입력해 주세요.` } };
  }
  if (maxTeamsPerDivision > maxTeamsPerSchool) {
    return { error: { code: "DIVISION_LIMIT_EXCEEDS_SCHOOL_LIMIT", message: "한 종별 최대 팀 수는 학교 전체 최대 팀 수보다 클 수 없습니다." } };
  }

  return {
    value: {
      maxTeamsPerSchool,
      maxTeamsPerDivision,
      teamCountEnabled: maxTeamsPerDivision >= 2,
    },
  };
}

export function validateTeamSelection({
  sportName,
  divisionName,
  requestedCount,
  currentSportTotal,
  maxTeamsPerSchool,
  maxTeamsPerDivision,
}) {
  const teamCount = Number(requestedCount);
  if (!Number.isInteger(teamCount) || teamCount < 1) {
    return { error: { code: "INVALID_TEAM_COUNT", message: "참가팀 수를 확인해 주세요." } };
  }
  if (teamCount > maxTeamsPerDivision) {
    return {
      error: {
        code: "DIVISION_TEAM_LIMIT_EXCEEDED",
        message: `${sportName} ${divisionName}는 한 종별에서 최대 ${maxTeamsPerDivision}팀까지 신청할 수 있습니다.`,
      },
    };
  }
  const sportTotal = currentSportTotal + teamCount;
  if (sportTotal > maxTeamsPerSchool) {
    return {
      error: {
        code: "SCHOOL_TEAM_LIMIT_EXCEEDED",
        message: `${sportName}는 모든 종별을 합쳐 학교 전체 최대 ${maxTeamsPerSchool}팀까지 신청할 수 있습니다.`,
      },
    };
  }
  return { value: { teamCount, sportTotal } };
}
