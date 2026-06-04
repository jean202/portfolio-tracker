# Portfolio Tracker

포트폴리오의 모든 프로젝트를 자동으로 스캔하고, 진행률, 활동 상황, 준비도를 한눈에 파악할 수 있는 CLI 도구입니다.

## ✨ 주요 기능

- 📁 **자동 프로젝트 감지**: 지정된 디렉토리에서 프로젝트 자동 발견
- 📊 **진행률 추적**: README, CLAUDE.md, 체크박스, 키워드 등으로 진행률 자동 감지
- 🎯 **신뢰도 & 근거**: 진행률 추정의 근거(signals)와 신뢰도(confidence) 표시
- 📈 **포트폴리오 준비도**: 진행률, 활동성, 문서화 수준을 종합한 0~100 점수
- 📝 **다양한 출력**: Console, Markdown, HTML, JSON
- 🏷️ **우선순위 자동 분류**: CRITICAL/HIGH/MEDIUM/LOW 자동 지정
- 🔄 **캐시 지원**: 스캔 결과 저장 & 빠른 조회
- ⏱️ **주기적 스캔**: `watch` 명령으로 일정 주기마다 자동 스캔

## 설치

```bash
npm install
npm run build
```

개발 중에는:

```bash
npm run start -- report
```

글로벌 설치:

```bash
npm link
portfolio-tracker report
```

## 빠른 시작

```bash
# 1. 초기화 (기본 디렉토리로)
portfolio-tracker init

# 2. 프로젝트 디렉토리 추가
portfolio-tracker config add ~/my-projects
portfolio-tracker config add ~/work/projects

# 3. 스캔 & 리포트
portfolio-tracker report --refresh

# 4. HTML로 내보내기
portfolio-tracker export -f html -o report.html

# 5. 자동 스캔 시작
portfolio-tracker watch
```

## 커맨드

### init - 초기화

```bash
portfolio-tracker init
```

대화형 모드로 프로젝트 디렉토리를 설정합니다:

```
? 기본 디렉토리를 사용하시겠어요? (Y/n)
? 추가 디렉토리를 더 추가하시겠어요? (y/N)
```

기본값 사용:

```bash
portfolio-tracker init --non-interactive
```

### config - 설정 관리

**현재 설정 확인:**

```bash
portfolio-tracker config list
```

**디렉토리 추가:**

```bash
portfolio-tracker config add ~/my-projects
```

**디렉토리 제거:**

```bash
portfolio-tracker config remove ~/old-projects
portfolio-tracker config rm ~/old-projects
```

**공통 알림 정책 설정:**

```bash
portfolio-tracker config notifications --progress-threshold 8
```

### stats - 통계 요약

포트폴리오 전체 통계를 한눈에 확인합니다:

```bash
portfolio-tracker stats
```

**표시 정보:**

- 개요 (전체/활성 프로젝트, 평균 진행률, 준비도)
- 우선순위별 분포 (CRITICAL/HIGH/MEDIUM/LOW)
- 기술 타입별 분포
- 진행률 분포 (0-25%, 25-50%, ..., 100%, 판단불가)
- 활동성 분포 (이번 주/최근/오래됨/잊혀짐/Git 없음)

### watch - 주기적 자동 스캔

터미널에서 프로세스를 계속 띄워두고 설정된 주기마다 스캔합니다. 결과는 `.portfolio-tracker/scan-result.json`과 `.portfolio-tracker/history/`에 저장됩니다.

```bash
# config.json의 scanInterval 사용 (기본 24시간)
portfolio-tracker watch

# 30분마다 스캔
portfolio-tracker watch --interval 30m

# 시작 직후 스캔하지 않고 다음 주기부터 실행
portfolio-tracker watch --no-initial

# 한 번만 스캔하고 종료
portfolio-tracker watch --once
```

지원하는 시간 단위는 `ms`, `s`, `m`, `h`, `d`입니다.

```bash
portfolio-tracker watch --interval 15m
portfolio-tracker watch --interval 2h
portfolio-tracker watch --interval 1d
```

### service - macOS 로그인 자동 실행

macOS `launchd`에 등록해서 맥 로그인 시 자동 스캔을 시작합니다. 끄거나 제거할 때도 CLI로 처리할 수 있습니다.

```bash
# 로그인 자동 실행 등록 + 즉시 시작
portfolio-tracker service install

# 30분마다 스캔하도록 등록
portfolio-tracker service install --interval 30m

# 현재 실행 중인 서비스만 중지 (다음 로그인 때 다시 시작)
portfolio-tracker service stop

# 다시 시작
portfolio-tracker service start

# 상태 확인
portfolio-tracker service status

# 로그 확인
portfolio-tracker service logs

# 자동 실행 등록까지 완전히 제거
portfolio-tracker service uninstall
```

서비스 로그는 `~/Library/Logs/portfolio-tracker/watch.log`와 `watch.error.log`에 저장됩니다.

### agent - local-mac-sub-agent 연동

`portfolio-tracker`가 스캔 결과를 만든 뒤 local-mac-sub-agent에 macOS 알림이나 리포트 열기 요청을 보낼 수 있습니다.

```json
{
  "subAgent": {
    "enabled": true,
    "baseUrl": "http://127.0.0.1:4877",
    "tokenFile": "/Users/jean325/Documents/sub-agent/data/token",
    "notifyOnScan": true,
    "notifyOnChanges": true,
    "openReportOnChanges": false
  }
}
```

```bash
# 설정 저장
portfolio-tracker config agent --enable --base-url http://127.0.0.1:4877 --token-file /Users/jean325/Documents/sub-agent/data/token

# 연결 상태 확인
portfolio-tracker agent status

# 테스트 알림 전송
portfolio-tracker agent test

# HTML 리포트 생성 후 sub-agent로 열기
portfolio-tracker agent open-report
```

`watch` 실행 중에는 스캔이 끝날 때 `sub-agent`로 알림이 전송됩니다.

### kakao - 카카오톡 나에게 보내기

`portfolio-tracker`가 스캔 요약을 카카오톡 "나와의 채팅방"으로 보낼 수 있습니다.

준비:

1. Kakao Developers에서 앱 생성
2. Kakao Login 활성화
3. Redirect URI 등록: `http://localhost:4888/kakao/callback`
4. 동의 항목에서 `talk_message` 사용 설정
5. 메시지 템플릿 링크에 사용할 Web domain 등록
   - 예: `https://jean202.github.io`
   - 카카오 메시지 버튼은 `linkUrl`에 지정한 모바일 웹 리포트로 이동합니다.

`config.json` 예시:

```json
{
  "kakao": {
    "enabled": true,
    "restApiKey": "YOUR_REST_API_KEY",
    "redirectUri": "http://localhost:4888/kakao/callback",
    "tokenFile": ".portfolio-tracker/kakao-token.json",
    "linkUrl": "https://jean202.github.io/portfolio-tracker/",
    "notifyOnScan": true,
    "notifyOnChanges": true
  }
}
```

인증과 테스트:

```bash
portfolio-tracker config kakao --enable --rest-api-key YOUR_REST_API_KEY
portfolio-tracker kakao auth
portfolio-tracker kakao status
portfolio-tracker kakao test
```

`kakao status`는 토큰 만료, `talk_message` 권한, 메시지 버튼 `linkUrl`과 Kakao Developers Web domain 등록 후보를 함께 점검합니다. 인증이 끝나면 `watch` 실행 중 스캔 완료 요약이 카카오톡 나와의 채팅방으로 전송됩니다. 토큰 파일은 `.portfolio-tracker/kakao-token.json`에 저장됩니다.

### recommend - 작업 추천

오늘 작업하기 좋은 프로젝트와 잊고 있던 프로젝트를 추천합니다:

```bash
# 기본 (TOP 3)
portfolio-tracker recommend
portfolio-tracker reco          # 단축어

# 추천 개수 변경
portfolio-tracker recommend -n 5
```

**추천 기준:**

- ✓ CRITICAL/HIGH 우선순위 (+30/+20점)
- ✓ 최근 활동 있음 (+15점)
- ✓ 진행률 70%+ (마무리 단계, +25점)
- ✓ 구체적인 다음 작업 있음 (+10점)
- ✓ 막힘(이슈) 없음 (+10점)

**잊혀진 프로젝트 감지:**

- 14일+ 미활동
- 진행률 30% 이상 (시작은 했지만 멈춤)
- 진행률 90% 미만 (거의 다 하지 않음)
- LOW 우선순위 아님

### search - 프로젝트 검색

다양한 조건으로 프로젝트를 검색합니다:

```bash
# 키워드 검색 (이름/설명/스택에서)
portfolio-tracker search react
portfolio-tracker s flutter           # 단축어

# 타입 필터
portfolio-tracker search --type kotlin

# 우선순위 필터
portfolio-tracker search --priority CRITICAL

# 진행률 범위
portfolio-tracker search --min-progress 50 --max-progress 90

# 준비도 필터
portfolio-tracker search --min-readiness 70

# 활성 프로젝트만
portfolio-tracker search --active

# 이슈 있는 프로젝트만
portfolio-tracker search --has-issues

# 조합
portfolio-tracker search --type kotlin --priority HIGH --active
```

### history - 스캔 히스토리

스캔 결과는 `.portfolio-tracker/history/` 폴더에 자동 저장되어 시간에 따른 변화를 추적할 수 있습니다.

```bash
# 전체 히스토리 (최근 10개)
portfolio-tracker history
portfolio-tracker hist                # 단축어

# 표시 개수 변경
portfolio-tracker history -n 20

# 특정 프로젝트의 히스토리
portfolio-tracker history asset-radar
```

**프로젝트 히스토리 표시:**

- 시점별 진행률, 신뢰도, 준비도, 활동 변화
- 전체 변화 요약 (▲ +18%p 형태)

### diff - 이전 스캔과 비교

```bash
# 가장 최근 스캔과 그 직전 스캔 비교
portfolio-tracker diff

# N번째 이전 스캔과 비교
portfolio-tracker diff -n 3
```

**표시 정보:**

- 요약 변화 (전체/활성 프로젝트, 평균 진행률, 준비도)
- ✨ 새 프로젝트
- 💀 사라진 프로젝트
- 🚀 변화가 큰 프로젝트 TOP 10

### trends - 트렌드 분석

```bash
# 최근 10개 스캔 기준
portfolio-tracker trends

# 분석 기간 변경
portfolio-tracker trends -n 30
```

**표시 정보:**

- 평균 진행률 추이 (시각적 바 차트)
- 포트폴리오 준비도 추이
- 활성 프로젝트 수 추이
- 전체 변화 요약 (처음 → 마지막)

**예시 출력:**

```
평균 진행률 추이
  04. 25. 오후 12:48 █████████████░░░░░░░░░░░ 42%
  04. 29. 오후 12:48 ███████████████░░░░░░░░░ 50%
  05. 02. 오후 12:48 █████████████████░░░░░░░ 55%

전체 변화 (처음 → 마지막)
  평균 진행률: 42% → 55% (▲ +13%p)
  준비도: 50% → 60% (▲ +10%p)
```

### detail - 프로젝트 상세 정보

특정 프로젝트의 상세 정보를 확인합니다:

```bash
portfolio-tracker detail <프로젝트명>
# 또는
portfolio-tracker d <프로젝트명>
```

**표시 정보:**

- 기본 정보: 타입, 우선순위, 설명
- 진행률: 완료도, 신뢰도, 근거(signals), 체크박스 통계
- 활동: 마지막 커밋, 커밋 메시지, 지난 7일 커밋 수
- 문서: README, CLAUDE.md, Git 존재 여부
- 기술 스택: 감지된 모든 기술
- 준비도: 포트폴리오 준비도 점수
- 이슈: 감지된 문제점들
- 다음 작업: 할 일 목록

**예시:**

```bash
$ portfolio-tracker detail asset-radar

📁 asset-radar
/Users/jean325/portfolio/projects/asset-radar

기본 정보
  타입: kotlin
  우선순위: CRITICAL
  설명: asset-radar

진행률
  완료도: 83%
  신뢰도: high
  근거 (Signals):
    - 68/82 checklist items completed
    - PROJECT_PLAN.md: checklist

활동
  마지막 커밋: 2026. 4. 25. 오후 2:26
  메시지: Implement KIS OAuth2 token management
  지난 7일 커밋: 1개
  상태: 활성

...
```

새로 스캔해서 조회:

```bash
portfolio-tracker detail asset-radar --refresh
```

### scan - 스캔

```bash
# 스캔 & 저장
portfolio-tracker scan

# 스캔만 수행
portfolio-tracker scan --no-save
```

`.portfolio-tracker/scan-result.json`에 결과 저장

### report - 리포트 보기

```bash
# 캐시된 결과 보기
portfolio-tracker report

# 새로 스캔 후 보기
portfolio-tracker report --refresh

# 모든 프로젝트 표시 (기본: CRITICAL/HIGH/MEDIUM만)
portfolio-tracker report --all
```

### export - 내보내기

```bash
# Markdown (기본값)
portfolio-tracker export -f markdown -o report.md

# HTML
portfolio-tracker export -f html -o report.html

# JSON
portfolio-tracker export -f json -o report.json

# 새로 스캔해서 내보내기
portfolio-tracker export -f html --refresh -o report.html

# 모든 프로젝트 포함
portfolio-tracker export -f markdown --all
```

## 설정 (config.json)

`config.json` 파일로 프로젝트 디렉토리 관리:

```json
{
  "projectDirs": ["~/portfolio/projects", "~/IdeaProjects"],
  "scanInterval": 86400000,
  "excludePatterns": ["node_modules", ".git", ".next", "dist", "build"],
  "webhookUrl": "https://hooks.slack.com/services/...",
  "notification": {
    "progressChangeThreshold": 5
  }
}
```

**설정값:**

- `projectDirs` (필수): 스캔할 프로젝트 디렉토리 경로 배열
- `scanInterval` (선택): 자동 스캔 주기 (ms 단위, 기본값: 86400000 = 24시간)
- `excludePatterns` (선택): 스캔 제외 패턴 배열
- `webhookUrl` (선택): `watch` 실행 중 새 프로젝트 추가/삭제 또는 설정된 진행률 변화 기준 이상 변화하면 해당 URL로 POST 알림을 전송합니다.
- `notification.progressChangeThreshold` (선택): 변화 알림으로 볼 진행률 차이 기준입니다. 기본값은 `5`입니다.

## 진행률 감지 방식

프로젝트의 진행률을 다음 우선순위로 자동 감지합니다:

### 1. 명시적 진행률 (높은 신뢰도)

문서에서 다음 형식을 찾습니다:

```markdown
- Progress: 65%
- 진행률: 70%
- 완성도 80%
```

### 2. 체크박스 완료율 (중간 신뢰도)

TODO.md, PROJECT_PLAN.md의 체크박스를 세어 계산:

```markdown
- [x] 기능 A 구현
- [x] 기능 B 구현
- [ ] 기능 C 구현
      → 66% (2/3 완료)
```

### 3. 휴리스틱 신호 (낮은 신뢰도)

문서의 키워드로 상태 추정:

- **배포/출시 완료**: 85% - "배포 완료", "release done", "production ready"
- **MVP/핵심 기능 완료**: 70% - "MVP 완료", "core features done"
- **테스트 필요**: 60% - "테스트 필요", "test remaining"
- **초안/아이디어**: 20% - "초안", "draft", "prototype"
- **진행 중**: 45% - "진행 중", "in progress", "WIP"

### 4. 판단 불가

위의 어느것도 감지되지 않으면 `Unknown` (판단 불가)로 표시

## Portfolio Readiness 점수

포트폴리오의 **전체 준비도**를 0~100점으로 표시합니다.

### 점수 구성

| 항목        | 점수   | 기준                                |
| ----------- | ------ | ----------------------------------- |
| 진행률 품질 | 0~30점 | 진행률(0~20점) + 신뢰도(0~10점)     |
| 활동 품질   | 0~25점 | 최근 활동 여부, 커밋 주기           |
| 문서 품질   | 0~25점 | README(10) + CLAUDE.md(10) + Git(5) |
| 타입 성숙도 | 0~20점 | Known type(Node, Python 등)         |

### 예시

```
asset-radar:
  - 진행률 83% (high 신뢰도) = 30점
  - 최근 활성 = 25점
  - README + CLAUDE.md + Git = 25점
  - Kotlin type = 20점
  → 총 97%

discord-kakao-translator:
  - 진행률 판단 불가 = 0점
  - 최근 활성 아님 = 0점
  - Node type = 20점
  - README + Git = 15점
  → 총 50%
```

## 프로젝트 인식 기준

다음 중 **하나라도 있으면** 프로젝트로 인식:

- `README.md` 또는 `readme.md`
- `CLAUDE.md`
- `.git` 디렉토리
- `package.json` (Node.js)
- `pubspec.yaml` (Dart/Flutter)
- `pom.xml` (Java)
- `build.gradle` 또는 `build.gradle.kts` (Kotlin)
- `requirements.txt` 또는 `setup.py` (Python)
- `Cargo.toml` (Rust)
- `go.mod` (Go)

## 스캔되는 문서

각 프로젝트에서 자동으로 읽는 파일들:

1. CLAUDE.md
2. README.md / readme.md
3. PROJECT_PLAN.md
4. AGENTS.md
5. TODO.md / TODO.txt
6. mvp-plan.md
7. docs/\*.md (docs 디렉토리의 모든 마크다운)

## 우선순위 자동 분류

| 우선순위     | 조건                                                |
| ------------ | --------------------------------------------------- |
| **CRITICAL** | "critical", "긴급" 키워드 또는 Git 없음             |
| **HIGH**     | "high", "높음" 키워드 또는 진행률 0~80% + 최근 활성 |
| **MEDIUM**   | 최근 활성이거나 진행률 80% 이상인데 이슈 있음       |
| **LOW**      | 위의 어느것도 아님                                  |

## 출력 형식

### Console

```bash
portfolio-tracker report
```

프로젝트 목록 표(우선순위, 진행률, 준비도, 최근 활동, 이슈 포함)

### Markdown

```bash
portfolio-tracker export -f markdown -o report.md
```

마크다운 테이블 + 요약 통계 + Next Actions

### HTML

```bash
portfolio-tracker export -f html -o report.html
```

스타일링된 대시보드:

- 📊 Summary 메트릭
- 📋 인터랙티브 테이블
- 📝 Next Actions 섹션

### JSON

```bash
portfolio-tracker export -f json -o report.json
```

프로그래밍 가능한 구조화된 데이터

## 개발

```bash
npm run build
npm run lint
npm test -- --run
```

테스트 (watch mode):

```bash
npm test -- --watch
```

## 향후 계획

이 도구의 다음 단계를 알고 싶으시다면 [**ROADMAP.md**](./ROADMAP.md)를 확인하세요:

- 📦 **v0.2.0** - CLI 강화 (증분 스캔, 트렌드 분석, daemon 모드)
- 🌐 **v0.3.0** - 백엔드 API (인증, 시계열 데이터)
- 📱 **v0.4.0** - 모바일 앱 (Flutter, 푸시 알림, AI 추천)
- 👥 **v1.0.0** - 협업 & 팀 기능

## 변경 이력

[CHANGELOG.md](./CHANGELOG.md) 참고

## 라이센스

[MIT License](./LICENSE)
