# dongbu-application

동부교육지원청 학교스포츠클럽대회 참가 신청 웹 애플리케이션입니다.

운영 주소: <https://dongbu-application.qkrwlgns5.workers.dev>

## 주요 기능

- 42개 중학교별 기관번호 로그인
- 배구·3x3 농구·피구 및 남중부·여중부 참가 신청
- 종목별 `학교 전체 최대 팀 수`와 `한 종별 최대 팀 수`를 분리해 검증
- 기본 설정: 배구 전체 2팀·한 종별 2팀, 3x3 농구와 피구 전체 2팀·한 종별 1팀
- 저장 후 재로그인 시 기존 제출 내용 불러오기
- 신청 완료·참가 신청 없음·미신청 구분
- 관리자 학년도·대회명·신청 기간·종목 및 두 단계 팀 수 한도 관리
- 관리자 아이디·비밀번호 변경 및 전체 관리자 세션 만료
- 모든 학교의 종목·종별·팀 수 결과 종합

## 기술 구성

- vinext + React
- Cloudflare Worker Static Assets
- Cloudflare D1 + Drizzle 마이그레이션
- HttpOnly / SameSite 세션 쿠키
- PBKDF2-SHA-256 + 서버 pepper를 사용한 학교 기관번호 검증
- D1에 PBKDF2-SHA-256 해시만 저장하는 관리자 계정 인증

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

`.dev.vars`에는 다음 비밀값을 설정합니다. 이 파일은 Git에 포함되지 않습니다.

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SCHOOL_PASSWORD_PEPPER`

`ADMIN_USERNAME`과 `ADMIN_PASSWORD`는 `admin_credentials` 행이 없을 때 최초 관리자 계정을 만드는 부트스트랩 값입니다. 최초 로그인에 성공하면 관리자 비밀번호는 서버 pepper를 적용한 해시로 D1에 저장되며, 이후에는 D1 계정만 인증에 사용되고 환경 변수 계정으로 재시도하지 않습니다.

## 검증

```bash
npm run lint
npm test
```

## Cloudflare 배포

1. `dongbu-application-db` D1 데이터베이스를 만듭니다.
2. `wrangler.jsonc`의 `database_id`를 실제 D1 ID로 변경합니다.
3. D1 마이그레이션을 적용합니다.

```bash
npx wrangler d1 migrations apply dongbu-application-db --remote
```

4. Worker Secret을 등록합니다.

```bash
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SCHOOL_PASSWORD_PEPPER
```

5. 빌드 후 생성된 Worker 설정으로 배포합니다.

```bash
npm run build
npx wrangler deploy --config dist/server/wrangler.json
```

GitHub 자동 배포는 `main` 브랜치에서 빌드 명령 `npm ci && npm run build`, 배포 명령 `npx wrangler deploy --config dist/server/wrangler.json`을 사용합니다. D1 마이그레이션은 코드 배포와 별도로 적용해야 합니다.

## 보안 주의사항

- 학교 기관번호 원문은 코드·Git 기록·D1에 저장하지 않습니다.
- `.dev.vars`, Cloudflare API 토큰, 관리자 비밀번호, pepper를 커밋하지 마세요.
- 신청 기간 판정과 학교·관리자 권한 검사는 모두 서버에서 수행됩니다.
- 참가 신청은 각 종별 한도를 먼저 확인한 뒤, 해당 종목의 학교 전체 합계 한도를 다시 확인합니다.
- 관리자 계정 변경 시 기존 관리자 세션은 모두 만료됩니다. 계정 복구를 위해 D1의 `admin_credentials`를 초기화해야 하는 경우에는 먼저 백업하고, 새 부트스트랩 비밀값을 설정한 뒤 제한된 유지보수 창에서만 수행하세요.
