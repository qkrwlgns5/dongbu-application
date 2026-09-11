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
- 청록·화이트 프론트엔드, 학교 검색과 참가 신청 실시간 요약
- 대회별 로그인 안내 카드 문구 편집·미리보기 및 카드 중앙정렬
- 대회별 메인 상단 로고 문자·기관명·보조 문구·영문 문구·두 줄 제목 편집 및 미리보기
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
npm run typecheck
npm test
```

`npm test`는 실제 API 처리기를 독립적인 메모리 SQLite에 연결하여 카드·상단 문구 권한·저장·대회 분리, 학교 로그인·신청 재조회·팀 수 한도·기간 제한을 검증합니다. 운영 데이터나 운영 비밀번호는 테스트에 사용하지 않습니다.

## 메인페이지 상단 로고·제목 수정

관리자 → **대회·기간 설정** → **메인페이지 상단 로고·제목**에서 로고 문자(한글·영문·숫자 1~3자), 기관명, 기관명 아래 문구, 학년도 배지 옆 영문·안내 문구, 제목 첫째 줄·둘째 줄을 수정합니다. 아래 미리보기에서 확인 후 **상단 로고·제목 저장**을 누릅니다. **기본 문구 불러오기**는 저장하기 전까지 미리보기에만 적용됩니다. 학년도 배지는 위쪽 **대회 정보·신청 기간**의 학년도와 연동되며 따로 중복 저장하지 않습니다.

현재 공개 중인 대회에 저장한 설정은 메인페이지를 새로 열거나 새로고침하면 표시됩니다. 임시저장 대회의 문구는 해당 대회를 현재 대회로 설정할 때 공개됩니다. 관리자·로그인 후 신청 화면의 기본 브랜드는 변경하지 않습니다.

`0007_page_header_copy.sql`은 `tournaments.header_copy` 열만 기본값 `'{}'`로 추가합니다. 기존 카드·대회·학교·신청 기록은 변경하지 않으며, 코드 배포 전에 마이그레이션을 먼저 적용합니다. 헤더 저장은 관리자 인증·동일 출처 검사·허용 필드/문자열 검증을 거쳐 감사 로그와 함께 기록됩니다.

## 메인페이지 안내 카드 수정

관리자 → **대회·기간 설정** → **메인페이지 안내 카드 문구**에서 큰 제목, 제목 아래 문구, 학년도 안내, 참가 대상, 하단 안내를 수정합니다. 입력 중 오른쪽 미리보기에서 확인하고 **안내 카드 문구 저장**을 누릅니다. 각 대회에 독립적으로 저장되며 신청 기간·종목·학교 수는 실제 설정에서 자동 표시됩니다. 빈 문구는 숨겨지고 제목과 설명의 직접 입력한 줄바꿈은 유지됩니다.

`0006_event_card_copy.sql`은 기존 대회 테이블에 기본값이 빈 설정 객체인 `card_copy` 열만 추가합니다. 배포 시 이 마이그레이션을 먼저 적용한 뒤 새 Worker를 배포합니다. 구 버전 Worker와 기존 신청 기록에 호환되며 기존 대회 정보 저장 요청은 카드 문구를 덮어쓰지 않습니다.

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
