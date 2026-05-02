# Portfolio Tracker - 로드맵

CLI 도구를 넘어 **포트폴리오 매니지먼트 플랫폼**으로 확장하는 계획입니다.

## 비전

> "**잊혀진 프로젝트가 없는 포트폴리오**"
>
> 모든 디바이스에서 자신의 포트폴리오를 한눈에 보고, AI 추천으로 다음 작업을 알 수 있고, 푸시 알림으로 잊혀진 프로젝트를 다시 살릴 수 있도록.

---

## 현재 상태 (v0.1.0)

### 완성된 기능 ✅
- 자동 프로젝트 감지 & 진행률 추적
- 신뢰도/근거 기반 진행률 표시
- 포트폴리오 준비도 점수
- 통계 요약 (`stats`), 추천 (`recommend`), 검색 (`search`)
- 프로젝트 상세 정보 (`detail`)
- Markdown/HTML/JSON 내보내기

### 한계점 ⚠️
- 로컬 파일 시스템에 의존 (Node.js fs)
- 모바일에서 사용 불가
- 푸시 알림 없음
- 시계열 데이터 없음 (트렌드 분석 불가)
- 단일 디바이스만 지원

---

## Phase 1: CLI 강화 (v0.2.0) 📦

> 기간: ~1개월 / 난이도: ⭐⭐

### 1.1 증분 스캔 (Incremental Scan)
```bash
portfolio-tracker scan --incremental
```
- 마지막 스캔 이후 변경된 프로젝트만 재스캔
- 파일 수정 시간 기반 감지
- 수백 개 프로젝트도 빠르게 처리

### 1.2 트렌드 분석
```bash
portfolio-tracker trends --months 3
portfolio-tracker history --project asset-radar
```
- 시계열 데이터 저장 (`.portfolio-tracker/history.json`)
- 월별/주별 평균 진행률 변화
- 활성 프로젝트 수 추이
- 준비도 점수 변화

### 1.3 Daemon 모드
```bash
portfolio-tracker daemon --interval 1h
```
- 백그라운드에서 주기적 스캔
- 변경 사항 감지 시 webhook 호출
- macOS launchd / Linux systemd / Windows Task Scheduler 지원

### 1.4 CI/CD 통합
- GitHub Actions 템플릿 제공
- 자동 리포트 생성 & GitHub Pages 배포
- Slack/Discord 웹훅 통합

### 1.5 추가 통계
- 기여 그래프 (커밋 빈도)
- 프로젝트별 시간 추적
- 언어별/스택별 비교

---

## Phase 2: 백엔드 API (v0.3.0) 🌐

> 기간: ~2개월 / 난이도: ⭐⭐⭐

### 2.1 아키텍처

```
┌─────────────────────────────────────────────────┐
│  📱 클라이언트 (Web / Mobile)                    │
└────────────────┬────────────────────────────────┘
                 │ REST API
                 ▼
┌─────────────────────────────────────────────────┐
│  ☁️ Backend API (Fastify + TypeScript)          │
│  - 인증 (JWT)                                    │
│  - 프로젝트 CRUD                                  │
│  - 추천 엔진                                      │
│  - 알림 트리거                                    │
└────────────────┬────────────────────────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
┌──────────────┐  ┌──────────────────┐
│ 🗄️ DB        │  │ 🤖 로컬 Agent    │
│ PostgreSQL   │  │ (CLI daemon)     │
│ - users      │  │ - 주기적 스캔    │
│ - projects   │  │ - 결과 업로드    │
│ - scans      │  │ - 인증 토큰      │
│ - history    │  │                  │
└──────────────┘  └──────────────────┘
```

### 2.2 API 엔드포인트

```
# 인증
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh

# 사용자
GET  /api/me
PUT  /api/me/settings

# 스캔
POST /api/scans                    # 로컬 agent가 스캔 결과 업로드
GET  /api/scans/latest             # 최신 스캔 결과
GET  /api/scans/history            # 스캔 히스토리

# 프로젝트
GET  /api/projects
GET  /api/projects/:id
GET  /api/projects/:id/history     # 시계열 진행률

# 추천 & 알림
GET  /api/recommendations          # 오늘의 추천 작업
GET  /api/forgotten                # 잊힌 프로젝트
POST /api/notifications/subscribe  # 푸시 토큰 등록
```

### 2.3 데이터베이스 스키마

```sql
-- 사용자
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR UNIQUE NOT NULL,
  password_hash VARCHAR NOT NULL,
  created_at TIMESTAMP
);

-- 프로젝트
CREATE TABLE projects (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  name VARCHAR NOT NULL,
  path VARCHAR NOT NULL,
  type VARCHAR,
  metadata JSONB,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- 스캔 결과 (시계열)
CREATE TABLE scan_results (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  project_id UUID REFERENCES projects(id),
  progress_percentage INT,
  progress_confidence VARCHAR,
  progress_signals JSONB,
  readiness INT,
  priority VARCHAR,
  issues JSONB,
  next_actions JSONB,
  scanned_at TIMESTAMP,
  INDEX (user_id, project_id, scanned_at DESC)
);

-- 푸시 알림 토큰
CREATE TABLE push_tokens (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  device_type VARCHAR, -- ios, android, web
  token VARCHAR NOT NULL,
  created_at TIMESTAMP
);
```

### 2.4 CLI ↔ 백엔드 연동

```bash
# 로그인
portfolio-tracker login

# 자동 동기화 daemon
portfolio-tracker daemon --sync

# 수동 동기화
portfolio-tracker sync
```

---

## Phase 3: 모바일 앱 (v0.4.0) 📱

> 기간: ~2-3개월 / 난이도: ⭐⭐⭐⭐

### 3.1 기술 스택 후보

**Option A: Flutter** (추천)
- ✅ 단일 코드베이스 (iOS + Android + Web)
- ✅ 사용자가 이미 Flutter 프로젝트 보유 (Cleanera)
- ✅ 네이티브 성능

**Option B: React Native**
- ✅ JavaScript 생태계 활용
- ⚠️ Flutter보다 성능 약간 떨어짐

**Option C: PWA (Progressive Web App)**
- ✅ 빠른 개발
- ⚠️ 푸시 알림 제약 (iOS)

### 3.2 화면 구성

```
┌─────────────────────────────────────┐
│  📊 Dashboard                       │
│  - 전체 통계 카드                    │
│  - 우선순위 분포                     │
│  - 최근 활동 그래프                  │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  📋 Projects                        │
│  - 검색 / 필터                       │
│  - 카드 형식 리스트                  │
│  - 무한 스크롤                       │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  🎯 Recommendations                 │
│  - 오늘의 추천 (스와이프)            │
│  - 잊힌 프로젝트                     │
│  - "작업 시작" 버튼                  │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  📈 Trends                          │
│  - 진행률 시계열 차트                │
│  - 활동성 히트맵                     │
│  - 준비도 변화                       │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  🔔 Notifications                   │
│  - 알림 히스토리                     │
│  - 알림 설정                         │
└─────────────────────────────────────┘
```

### 3.3 푸시 알림 시나리오

| 트리거 | 알림 메시지 | 시간대 |
|--------|------------|--------|
| 매일 오전 9시 | "🎯 오늘의 추천 작업 3개" | 9:00 |
| 매주 월요일 | "📊 지난 주 리포트: 평균 진행률 +5%" | 9:00 (월) |
| 14일 무활동 | "💭 OOO 프로젝트가 2주째 멈춰있어요" | 18:00 |
| 90% 도달 | "🎉 OOO이 90% 완료! 마무리하세요" | 즉시 |
| 1주 활성 | "🔥 이번 주 활발한 프로젝트: OOO (5 commits)" | 일요일 18:00 |
| 새 이슈 감지 | "⚠️ OOO에 이슈 감지됨: README 없음" | 즉시 |

### 3.4 추천 엔진 고도화

**현재 (단순 스코어링):**
```typescript
score = priority + activity + completion_proximity + ...
```

**Phase 3 (사용자 행동 학습):**
```typescript
// 클릭/완료 데이터로 가중치 학습
score = ml_model.predict({
  user_history,
  project_features,
  time_of_day,
  day_of_week,
})
```

---

## Phase 4: 협업 & 팀 기능 (v1.0.0) 👥

> 기간: ~3개월 / 난이도: ⭐⭐⭐⭐⭐

### 4.1 팀 워크스페이스
- 팀 단위 포트폴리오 공유
- 팀원별 기여도 시각화
- 권한 관리 (admin, member, viewer)

### 4.2 통합 기능
- **GitHub**: PR/이슈 자동 가져오기
- **Notion**: 프로젝트 페이지 연동
- **Slack**: 팀 채널 알림
- **Discord**: 봇 통합
- **Linear/Jira**: 이슈 트래커 연동

### 4.3 분석 기능
- 팀 생산성 대시보드
- 번아웃 감지 (과도한 활동 패턴)
- 균형 지표 (특정 프로젝트 편중)

---

## 부가 기능 아이디어

### 🤖 AI 기능
- **자동 진행률 추론**: LLM으로 README 분석해 더 정확한 진행률
- **다음 작업 제안**: 코드 분석 후 다음 작업 자동 생성
- **이슈 자동 감지**: 코드 품질, 보안, 성능 이슈

### 📊 시각화 기능
- **D3.js 대시보드**: 인터랙티브 차트
- **활동 히트맵**: GitHub-style contribution graph
- **프로젝트 네트워크**: 의존성/유사도 관계도

### 🎮 게이미피케이션
- 진행률 달성 배지
- 연속 활동 streak
- 주간/월간 챌린지
- 친구와 경쟁

### 🔌 플러그인 시스템
- 커스텀 진행률 감지 규칙
- 커스텀 알림 룰
- 외부 서비스 연동

---

## 우선순위 추천

```
HIGH PRIORITY (당장 가치 있음)
├── 1.1 증분 스캔
├── 1.2 트렌드 분석
└── 2.1-2.4 백엔드 API

MEDIUM PRIORITY (사용성 향상)
├── 1.3 Daemon 모드
├── 1.4 CI/CD 통합
└── 3.x 모바일 앱

LOW PRIORITY (장기 비전)
├── 4.x 협업 기능
├── AI 기능
└── 게이미피케이션
```

---

## 기술 결정 사항

### 백엔드
- **Framework**: Fastify (속도 + TypeScript)
- **Database**: PostgreSQL (시계열 + JSONB)
- **Cache**: Redis (선택사항)
- **Auth**: JWT
- **Hosting**: Railway / Fly.io / Vercel

### 모바일
- **Framework**: Flutter (사용자 친화적)
- **State**: Riverpod
- **Push**: Firebase Cloud Messaging

### DevOps
- **CI/CD**: GitHub Actions
- **Monitoring**: Sentry
- **Analytics**: PostHog (오픈소스)

---

## 마일스톤 일정

```
2026 Q1 (현재) ───── v0.1.0 출시 ✅
2026 Q2 ───────── v0.2.0 (CLI 강화)
2026 Q3 ───────── v0.3.0 (백엔드 API)
2026 Q4 ───────── v0.4.0 (모바일 앱 베타)
2027 Q1 ───────── v1.0.0 (정식 출시)
```

---

## 기여 / 의견

- 이슈/PR 환영합니다!
- 새로운 기능 제안: GitHub Issues
- 버그 리포트: GitHub Issues

---

## 참고 자료

- [기여 가이드](./CONTRIBUTING.md) (TODO)
- [API 명세서](./docs/api.md) (Phase 2 시작 시)
- [아키텍처 문서](./docs/architecture.md) (Phase 2 시작 시)
