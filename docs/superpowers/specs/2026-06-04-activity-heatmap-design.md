# 활동 히트맵 (portfolio-tracker → pt-mobile) 설계

- 작성일: 2026-06-04
- 범위: **두 레포** — portfolio-tracker(TS CLI)가 일자별 커밋 데이터를 내보내고, pt-mobile(Flutter)이 GitHub식 히트맵으로 렌더링
- 상태: 설계 승인됨, 구현 계획 작성 대기

## 1. 목표

pt-mobile의 Trends 화면은 현재 "활성 프로젝트 추세" 라인 차트를 진짜 활동 히트맵의 대용으로 쓰고 있다. 이를 **포트폴리오 전체 커밋의 일자별 GitHub식 히트맵**(최근 13주)으로 교체한다. 이를 위해 portfolio-tracker가 프로젝트별 일자별 커밋 수를 `scan-result.json`에 내보내야 한다.

### 핵심 통찰
히트맵은 **최신 스캔 1장**의 git 데이터로 완성된다(스냅샷 히스토리 누적 불필요 — 라인 추세와 다름). 따라서 스냅샷이 1개만 있어도 히트맵을 보여주고, 진행률/준비도 라인 차트는 기존대로 2개 이상일 때만 표시한다.

### 비목표 (YAGNI)
- 프로젝트별 개별 히트맵(상세 화면): 범위 밖. 이번엔 **포트폴리오 전체 집계 1개**만.
- 1년치(52주) 풀 캘린더: 범위 밖. 13주 고정.
- 커밋 외 활동(이슈/PR 등): 범위 밖. git 커밋만.
- 시간대 정밀 보정: 커밋의 로컬 캘린더일 기준으로 단순화.

## 2. 데이터 계약 (portfolio-tracker)

`Activity`에 선택 필드 추가:

```ts
recentCommitDays?: Record<string, number>; // "YYYY-MM-DD"(로컬일) → 그 날 커밋 수. 0인 날은 생략.
```

- 윈도우: 최근 **91일**(13주). `git.log({ '--since': '91 days ago' })`로 수집.
- 집계 단위: **프로젝트별**. 앱이 전 프로젝트를 일자별로 합산한다(프레젠테이션 집계는 앱 책임 — 기존 `DashboardStats` 패턴과 일관).
- git 없음/실패 시 필드 생략(undefined). 앱은 빈 맵으로 처리.

## 3. 아키텍처

### PT 쪽 (TypeScript)

- `src/core/ProjectModel.ts`
  - `Activity`에 `recentCommitDays?: Record<string, number>` 추가.
- `src/core/Scanner.ts`
  - `detectActivity`: 기존 `git.log({ maxCount: 50 })`(latest/commitsInLastWeek/daysSinceLastCommit 계산)는 **변경하지 않는다**. 별도로 윈도우 쿼리 `git.log({ '--since': '91 days ago', maxCount: 2000 })`를 호출해 그 결과를 순수 헬퍼에 넘긴다.
  - 신규 순수 헬퍼 `buildCommitHistogram(commitDates: Date[], now: Date, days = 91): Record<string, number>`
    - `now`로부터 `days`일 이내의 커밋만 카운트.
    - 각 커밋을 로컬 캘린더일 `YYYY-MM-DD`로 포맷해 카운트 누적.
    - 0인 날은 키 생략. 빈 입력 → `{}`.
  - git 호출 실패는 기존 try/catch가 흡수 → 필드 생략.

### 앱 쪽 (Flutter, pt-mobile)

- `lib/models/project.dart`
  - `Activity`에 `Map<String, int> recentCommitDays` 추가(기본 `const {}`). tolerant 파싱: 값이 Map이 아니거나 항목 타입이 어긋나면 빈 맵/해당 항목 스킵.
- `lib/trends/commit_heatmap.dart` (신규, 순수 — 핵심 테스트 대상)
  - `HeatmapCell { DateTime date; int count; }`
  - `CommitHeatmap { List<List<HeatmapCell>> weeks; int maxCount; int total; }`
  - `factory CommitHeatmap.fromProjects(List<Project> projects, {required DateTime now, int weeks = 13})`
    - 전 프로젝트의 `recentCommitDays`를 일자별로 합산.
    - 그리드 범위: `now`가 속한 주의 토요일까지 포함하도록 정렬하고, 거기서 `weeks*7`일 거슬러 올라간 **일요일 시작**의 연속 그리드를 만든다.
    - 각 칸 count = 합산값(없으면 0). `weeks`개 컬럼 × 7행(일~토).
    - `maxCount` = 모든 칸 최대, `total` = 합.
- `lib/trends/activity_heatmap.dart` (신규 위젯)
  - `ActivityHeatmap { CommitHeatmap data }`: 작은 정사각 칸 그리드. 색 강도 5단계(고정 임계값): `count==0`, `1–2`, `3–4`, `5–7`, `8+`. 제목 "활동 히트맵". 총 커밋 수 라벨.
- `lib/trends/trends_screen.dart` (수정)
  - 게이팅 재구성:
    - 스냅샷 0개 → 기존 빈 상태("가져오세요").
    - 스냅샷 ≥1 → **히트맵 표시**(최신 스냅샷 = `history.first`의 projects로 `CommitHeatmap.fromProjects`).
    - 스냅샷 ≥2 → 히트맵 + 진행률/준비도 라인 차트 + 델타(기존).
  - 셋째 차트였던 "활성 프로젝트 추세" 라인은 **제거**(히트맵으로 대체).

## 4. 데이터 흐름

```
PT 스캔 → git.log(--since 91d) → buildCommitHistogram → Activity.recentCommitDays
  → scan-result.json
앱 import → Activity.recentCommitDays(파싱) → CommitHeatmap.fromProjects(합산·그리드)
  → ActivityHeatmap 위젯 (Trends)
```

## 5. 에러 처리 / 엣지

- git 없음/실패(PT) → 필드 생략 → 앱 빈 맵 → 히트맵 전부 0칸(여전히 그리드 렌더, total 0).
- 91일 내 커밋 0 → 빈 그리드 + total 0.
- 잘못된 날짜 키/음수 카운트(손상 데이터) → 앱 파싱에서 스킵/무시.
- 그리드 경계: `now` 포함 주가 항상 맨 오른쪽 컬럼. 미래 날짜 키는 무시.

## 6. 테스트 전략

- **PT** `buildCommitHistogram`(Vitest): 여러 날 커밋 그룹핑, 91일 윈도우 컷오프(밖 커밋 제외), 로컬일 포맷, 빈 입력 → `{}`.
- **앱** `CommitHeatmap.fromProjects`(flutter_test, 핵심):
  - 두 프로젝트의 같은 날 커밋이 합산되는지.
  - 커밋 없는 날 0으로 채워지는지, 그리드 크기 `weeks*7`.
  - `maxCount`/`total` 정확성.
  - 일요일 시작 정렬, `now` 주가 마지막 컬럼.
- **앱** `ActivityHeatmap` 위젯: 제목 + 예외 없음(스모크).
- **앱** Trends 통합: 스냅샷 1개로 히트맵 표시(라인차트 없음), 2개로 히트맵+라인.

## 7. 구현 단위 (두 레포 → 플랜 2개)

1. **PT 플랜** (먼저): `recentCommitDays` 필드 + `buildCommitHistogram` + Scanner 통합 + Vitest. 앱이 소비할 데이터를 먼저 만든다.
2. **앱 플랜**: `Activity` 파싱 + `CommitHeatmap` + `ActivityHeatmap` 위젯 + Trends 통합 + flutter_test.

## 8. 재사용 / 일관성

- PT: 기존 `simpleGit`/`detectActivity` 패턴, 순수 헬퍼 분리 컨벤션.
- 앱: 기존 tolerant `fromJson`, 순수 view-model(`DashboardStats`/`TrendSeries`) + fl_chart 외 커스텀 그리드 위젯, `flutter-tdd` 수직 슬라이스.
