# portfolio-tracker 모바일 앱 (Phase 3) 설계

- 작성일: 2026-06-03
- 스택: **Flutter** (단일 코드베이스: iOS / Android / Web/Desktop)
- 데이터 소스: **`scan-result.json` 직접 읽기** (백엔드 없음)
- 범위: **Phase 3 전체** (Dashboard / Projects / Recommendations / Trends / Notifications + 로컬 알림 + 온디바이스 추천)
- 상태: 설계 승인됨, 구현 계획 작성 대기

## 1. 목표

portfolio-tracker는 로컬 프로젝트 디렉토리를 스캔해 진행률·활동성·준비도(0~100)를 계산하고, 결과를 `.portfolio-tracker/scan-result.json`으로 출력하는 TypeScript CLI다. 현재 조회 수단은 콘솔/마크다운/HTML 리포트와 JSON뿐이며, **상시 휴대 가능한 뷰어가 없다.**

이 작업은 PT의 스캔 결과를 **모바일/데스크톱에서 보고, 추천을 받고, 추세를 추적하고, 알림을 받는** Flutter 앱을 만든다. PT 프로세스나 별도 서버에 의존하지 않고 **`scan-result.json`을 데이터 계약으로 직접 소비**한다.

### 비목표 (YAGNI)

- **서버 백엔드 / REST API**: 범위 밖. 앱은 파일 기반으로만 동작한다. (로드맵 Phase 2의 API는 별도 작업)
- **FCM 등 서버 푸시**: 범위 밖. 알림은 전부 온디바이스 로컬 알림으로 계산한다.
- **진짜 ML 모델 / 학습 서버**: 범위 밖. 추천은 온디바이스 투명 스코어링 + 경량 가중치 조정까지만.
- **PT → 앱 쓰기, 앱에서 스캔 실행, 멀티유저/인증/팀 기능**: 범위 밖(로드맵 Phase 4). 로컬 단일 사용자 전제.
- **양방향 동기화**: 앱은 읽기 전용 소비자다.

## 2. 핵심 설계 원칙

1. **PT는 데이터를 모르고, 앱은 PT를 모른다.** 둘의 유일한 계약은 `scan-result.json` 스키마. 앱은 미지 필드를 무시하는 관용적 파서로 스키마 변화에 강건하다.
2. **백엔드 없이 성립한다.** 푸시·추천·추세 등 원래 서버를 전제하던 기능을 전부 온디바이스로 재해석한다.
3. **스냅샷이 아니라 히스토리.** `scan-result.json`은 한 시점의 스냅샷 1장이다. Trends는 시계열을 요구하므로, import 때마다 스냅샷을 로컬 DB에 누적 적재해 추세의 원천으로 삼는다.
4. **데이터 접근은 한 추상화 뒤에 가둔다.** 동기화 메커니즘(파일 피커/클라우드/로컬 경로)이 바뀌어도 `ScanDataSource` 인터페이스만 교체한다.
5. **순수 함수로 로직을 분리한다.** 파서·스코어링·알림 트리거 판정은 부수효과 없는 순수 함수로 두어 단위 테스트 가능하게 한다.

## 3. 아키텍처

```
[ 동기화된 scan-result.json ]
            │  (파일 피커 / 클라우드 동기 경로 / 로컬 경로)
            ▼
   ScanDataSource ──▶ ScanResult (파싱·검증)
            │
            ▼
   SnapshotRepository (Drift) ──▶ 스냅샷 히스토리 누적
            │
            ├─▶ RecommendationEngine (온디바이스 스코어링)
            ├─▶ NotificationScheduler (로컬 알림 트리거 계산)
            └─▶ Riverpod providers ──▶ 5개 화면
```

### 계층

- **데이터 접근**: `ScanDataSource` — 최신 `ScanResult`를 로드. 1차 구현은 파일 피커로 가져온 파일 + 마지막 경로 기억 + 로컬 캐시. (데스크톱/웹은 설정된 로컬 경로 구현체로 확장 가능)
- **영속화**: `SnapshotRepository`(Drift/SQLite) — import된 스냅샷을 타임스탬프와 함께 히스토리로 적재·조회. 설정/알림 토글은 `shared_preferences`.
- **도메인 로직**: `RecommendationEngine`, `NotificationScheduler`, 추세 집계기 — 전부 순수 함수 또는 얇은 서비스.
- **상태관리**: Riverpod providers가 repository/엔진을 화면에 노출.
- **프레젠테이션**: 5개 화면 + 공용 위젯.

### 기술 선택

| 영역 | 선택 | 이유 |
|------|------|------|
| 프레임워크 | Flutter | 단일 코드베이스, 기존 Flutter 자산·툴링 보유 |
| 상태관리 | Riverpod | 테스트 용이, provider 단위 격리 |
| 모델 | freezed + json_serializable | 불변·관용적 파싱 |
| 로컬 DB | Drift (SQLite) | 스냅샷 히스토리 시계열 저장 (`flutter-drift-setup` 활용) |
| 단순 설정 | shared_preferences | 알림 토글·마지막 파일 경로 |
| 로컬 알림 | flutter_local_notifications + 백그라운드 fetch | 서버 없는 스케줄 알림 |
| 차트 | fl_chart | 시계열·히트맵·분포 |

## 4. 데이터 모델 (TS 스키마 → Dart 미러)

`scan-result.json` 최상위: `{ projects, scannedAt, summary }`.

프로젝트 항목 키 (현재 출력 기준):

```
id, name, path, type,
progress { percentage, source, confidence, signals[], lastUpdated },
priority,            // CRITICAL | HIGH | MEDIUM | LOW
activity { lastCommitDate, lastCommitMessage, commitsInLastWeek, isActive, daysSinceLastCommit },
metadata { description, stack[], hasReadme, hasClaude, hasGit },
baseReadiness,       // 0~100 (파일시스템 기반 4버킷)
readiness,           // 0~100 (최종 = baseReadiness + threadAdjustment, 100 상한)
nextActions[], issues[], scannedAt,
continuity?          // ThreadKeeper enrichment 결과 (있을 수도, 없을 수도)
```

Dart 측: `ScanResult`, `Project`, `Progress`, `Activity`, `Metadata`, `ScanSummary`, `Continuity?`를 freezed로 정의. **모든 필드는 nullable-안전하게** 다루고, 미지 필드는 무시한다(스키마 진화 대비). `continuity`는 PT 설정에 따라 없을 수 있으므로 optional.

## 5. 화면 (각 화면 = 수직 슬라이스 / 구현 마일스톤)

### 5.1 Dashboard
- 전체 통계 카드 (`summary`에서: 총 프로젝트 수, 평균 진행률/준비도, 우선순위별 카운트)
- 우선순위 분포 (CRITICAL/HIGH/MEDIUM/LOW 분포 차트)
- 최근 활동 그래프 (최근 커밋 활동 기반)
- 빈 상태: 데이터 미import 시 "스캔 결과를 가져오세요" 안내

### 5.2 Projects
- 검색(이름/경로/스택) + 필터(priority, type, isActive, 준비도 구간) + 정렬(준비도/진행률/최근활동)
- 카드 리스트 (lazy 스크롤), 카드: 이름·priority 배지·진행률/준비도·마지막 커밋·이슈 수
- 탭 → 프로젝트 상세 (전체 필드 + `nextActions` + `issues` + `continuity` 표시)

### 5.3 Recommendations
- 오늘의 추천 N건 (스와이프 카드): `RecommendationEngine` 점수 상위
- 잊힌 프로젝트 섹션 (`daysSinceLastCommit` 큰 항목)
- "작업 시작" 액션: 프로젝트 경로 복사 / (가능 시) 딥링크·공유
- 상호작용(탭/무시) 기록 → 엔진 가중치 조정 입력

### 5.4 Trends
- 진행률 시계열 (스냅샷 히스토리)
- 활동성 히트맵 (날짜 × 활동)
- 준비도 변화 (프로젝트별/전체)
- 빈 상태: 스냅샷 1개뿐이면 "추세를 보려면 import를 누적하세요" 안내

### 5.5 Notifications
- 알림 히스토리 (발생한 로컬 알림 로그)
- 트리거별 on/off 설정 (6종, §6)

## 6. 로컬 알림 트리거 (온디바이스 계산)

서버 푸시 없이, 백그라운드 fetch/스케줄 시 **최신 스냅샷과 직전 스냅샷을 비교**해 판정한다.

| 트리거 | 조건 | 스케줄 |
|--------|------|--------|
| 오늘의 추천 | 추천 상위 3건 | 매일 09:00 |
| 주간 리포트 | 지난 주 대비 평균 진행률 변화 | 월 09:00 |
| 무활동 알림 | `daysSinceLastCommit ≥ 14` | 18:00 |
| 90% 도달 | `progress.percentage ≥ 90` (직전 < 90) | 즉시(다음 fetch) |
| 주간 활발 | 주간 커밋 최다 프로젝트 | 일 18:00 |
| 새 이슈 감지 | `issues`에 신규 항목 출현 | 즉시(다음 fetch) |

각 트리거는 사용자가 끌 수 있고, 발생 시 Notifications 히스토리에 기록한다. 백그라운드 갱신은 OS 제약(특히 iOS) 안에서 best-effort로 동작한다.

## 7. 추천 스코어링 (온디바이스)

PT의 단순 스코어링 개념을 Dart로 이식한 **투명한 가중치 합**:

```
score = w_priority·priorityWeight(priority)
      + w_proximity·completionProximity(progress)   // 90%대 가산
      + w_stale·stalenessNudge(daysSinceLastCommit)
      + w_readiness·readinessFactor(readiness)
      + w_issues·issuePenalty(issues)
```

- v1 기본 가중치는 상수. 사용자 상호작용(추천 탭=가산, 무시=감산)을 로컬에 누적해 **가중치를 소폭 조정**하는 경량 학습까지가 범위. 진짜 ML 모델은 비목표.
- 스코어링은 순수 함수로 두어 단위 테스트한다.

## 8. 에러 처리 / 엣지 케이스

- 파일 없음 / 권한 거부 → 안내 + 재선택 유도
- JSON 파싱 실패 / 스키마 불일치 → 부분 파싱 가능분만 표시, 손상 항목 스킵, 경고 배너
- 빈 `projects` → 빈 상태 화면
- 스냅샷 0~1개 → Trends 빈/제한 상태
- stale 데이터 (오래된 `scannedAt`) → "마지막 갱신 N일 전" 배지로 노출
- 백그라운드 fetch 실패 → 마지막 캐시로 동작

## 9. 테스트 전략

- **`flutter-tdd` 수직 슬라이스 원칙**: 화면 단위로 red-green-refactor.
- 순수 로직(파서, 스코어링, 트리거 판정, 추세 집계)은 **순수 함수 단위 테스트** 우선.
- 화면은 **`flutter-robot-testing`** 로봇 위젯 테스트로 사용자 여정 검증.
- Drift repository는 인메모리 DB로 테스트.
- `ScanDataSource`는 인터페이스 mock으로 주입.

## 10. 구현 순서 (전체 유지, 증분 가능)

각 단계는 동작하는 앱을 남긴다.

1. **토대**: Flutter 프로젝트 생성 + 모델(freezed) + `ScanDataSource`(파일 피커) + Drift `SnapshotRepository` + import 플로우.
2. **Dashboard**: summary 카드 + 분포/활동 차트 + 빈 상태.
3. **Projects**: 리스트 + 검색/필터/정렬 + 상세.
4. **Recommendations**: `RecommendationEngine` + 스와이프 카드 + 상호작용 기록.
5. **Trends**: 스냅샷 히스토리 집계 + 시계열/히트맵 차트.
6. **Notifications**: `NotificationScheduler` + 로컬 알림 + 히스토리/설정.

## 11. 미해결 / 후속

- 모바일에서의 정확한 동기화 경로(iCloud/Drive/공유 폴더) 선택은 1차 구현 중 파일 피커로 시작하고 사용 경험 보고 확정.
- 데스크톱/웹용 "로컬 경로 자동 감시" `ScanDataSource` 구현체는 토대 이후 선택적 추가.
- 로드맵 Phase 2(읽기 API)가 나중에 생기면 `ScanDataSource`에 HTTP 구현체를 추가하는 형태로 흡수 가능(스키마 동일).
