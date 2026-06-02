# portfolio-tracker ↔ ThreadKeeper 통합 설계

- 작성일: 2026-06-02
- 방향: **TK → PT (방향 C)** — ThreadKeeper의 thread 데이터를 portfolio-tracker의 준비도 점수와 리포트에 직접 반영
- 상태: 설계 승인됨, 구현 계획 작성 대기

## 1. 목표

portfolio-tracker는 로컬 프로젝트 디렉토리를 스캔해 진행률·활동성·준비도(0~100)를 계산한다. ThreadKeeper는 프로젝트별 AI 작업 thread(의도·다음 액션·상태·활동)를 관리한다. 두 시스템의 공통 키는 **프로젝트 단위**다.

이 작업은 ThreadKeeper의 thread 신호를 portfolio-tracker의 **준비도 점수 계산식에 직접 반영**하고, 동시에 리포트에 thread 컨텍스트를 함께 표시한다. ThreadKeeper는 portfolio-tracker 프로세스 바깥의 별도 서비스(Spring Boot, REST)이므로, 가용성에 따라 점수가 흔들리지 않도록 **점수 분해(지표화) + 캐시 fallback**으로 변동성을 통제한다.

### 비목표 (YAGNI)

- PT → TK 방향 쓰기(스레드 자동 생성/갱신)는 범위 밖.
- drift_status는 표시·점수 어디에도 사용하지 않는다(사용자 결정).
- 양방향 동기화, 인증/멀티유저는 범위 밖. 로컬 단일 사용자 실험 전제.

## 2. 핵심 설계 원칙

1. **base 점수는 절대 흔들리지 않는다.** 파일시스템 기반 4버킷 점수는 ThreadKeeper 가용성과 무관하게 항상 재현 가능하다.
2. **변동성은 한 칸에 가둔다.** ThreadKeeper 기여분은 `threadAdjustment`라는 단일 컴포넌트로 분리되어, on/off 차이가 점수 전체에 퍼지지 않고 읽을 수 있는 지표가 된다.
3. **graceful degradation.** ThreadKeeper가 꺼져 있어도 리포트는 base 점수로 정상 동작한다.

## 3. 아키텍처

스캔 흐름을 2단계로 분리한다.

1. **base 스캔** (기존, 동기·파일시스템): `baseReadiness` 계산. 네트워크 무관.
2. **thread enrichment** (신규, 비동기·네트워크): thread 신호로 `threadAdjustment`와 continuity 정보 채움. `Config.threadKeeper.enabled`가 true일 때만 실행.

### 신규 파일

- `src/core/ThreadKeeperClient.ts`
  - 책임: ThreadKeeper REST 호출 (`GET /api/v1/threads?projectKey=...`).
  - 인터페이스: `fetchThreads(projectKey: string): Promise<RawThread[]>`. 타임아웃(`timeoutMs`) 초과·네트워크 에러·non-2xx는 명확한 에러로 throw.
  - 의존: `fetch`(Node 20+ 내장), `Config.threadKeeper.baseUrl`.

- `src/core/ThreadEnricher.ts`
  - 책임: 스캔된 프로젝트 목록을 받아 각 프로젝트의 continuity 정보를 채운다.
  - 절차: project_key 해석 → `ThreadKeeperClient.fetchThreads` → 실패 시 `ThreadCache` fallback → `ThreadSummary` 집계 → `threadAdjustment`+signals 계산 → coverage 판정 → 성공 시 `ThreadCache`에 저장.
  - 인터페이스: `enrichWithThreads(projects: Project[]): Promise<void>` (프로젝트를 in-place로 갱신하거나 새 배열 반환).
  - 의존: `ThreadKeeperClient`, `ThreadCache`, `Config.threadKeeper`.

- `src/storage/ThreadCache.ts`
  - 책임: project_key별 마지막 `ThreadSummary` + 타임스탬프 영속화 (fallback용).
  - 인터페이스: `load(): ThreadCacheData`, `save(projectKey, summary, fetchedAt)`, `get(projectKey): { summary, fetchedAt } | null`.
  - 저장 위치: `.portfolio-tracker/thread-cache.json` (기존 캐시 디렉토리 컨벤션 따름).

### 변경 파일

- `src/core/ProjectModel.ts`
  - `Project`에 필드 추가:
    - `baseReadiness: number` — 내부 4버킷 점수(0~100)
    - `continuity?: ContinuitySummary` — thread enrichment 결과
    - 기존 `readiness`는 최종 점수(`baseReadiness + threadAdjustment`, 100 상한)로 유지
  - 신규 타입 `ContinuitySummary`, `ThreadSummary`, `RawThread`, `ThreadCoverage` 추가.
  - `Config`에 `threadKeeper?: ThreadKeeperConfig` 추가.

- `src/core/Scanner.ts`
  - base 스캔 완료 후, enable 시 `ThreadEnricher.enrichWithThreads(projects)`를 await하는 패스 추가.
  - `calculateReadiness` 결과는 `baseReadiness`로 저장. enrichment가 `readiness = min(100, baseReadiness + threadAdjustment)` 갱신.

- 리포트 4종 (`ConsoleReport`/MarkdownReport/HtmlReport/JsonReport): continuity 섹션 렌더링 (§6).

## 4. 데이터 모델

```ts
type ThreadCoverage = "live" | "stale" | "unavailable";

interface RawThread {            // ThreadKeeper /api/v1/threads 응답 항목
  id: number;
  projectKey: string;
  title: string;
  status: string;                // 예: IN_PROGRESS, COMPLETED, BLOCKED
  priority: string;
  originalIntent?: string;
  currentNextAction?: string;
  lastActivityAt?: string;       // ISO timestamp
}

interface ThreadSummary {
  projectKey: string;
  total: number;
  active: number;                // status가 진행중 계열인 thread 수
  completed: number;
  representative?: {             // 대표 thread (활성 중 최신 활동, 없으면 최고 우선순위)
    title: string;
    status: string;
    priority: string;
    currentNextAction?: string;
  };
  activeThreads: Array<{         // 상세 뷰용 활성 thread 전체
    title: string;
    status: string;
    priority: string;
    currentNextAction?: string;
    lastActivityAt?: string;
  }>;
  mostRecentActivityAt?: string;
}

interface ContinuitySummary {
  coverage: ThreadCoverage;
  summary?: ThreadSummary;       // unavailable이면 undefined
  threadAdjustment: number;      // 0~20
  signals: string[];             // 점수 근거 문자열
  fetchedAt?: string;            // stale일 때 캐시 시점 표시용
  ageDays?: number;              // stale 데이터 나이
}

interface ThreadKeeperConfig {
  enabled?: boolean;             // default false
  baseUrl?: string;              // default "http://localhost:8080"
  timeoutMs?: number;            // default 2000
  staleMaxDays?: number;         // default 14
  projectKeyOverrides?: Record<string, string>; // 디렉토리 path 또는 name → projectKey
}
```

## 5. 점수 모델

```
readiness = min(100, baseReadiness + threadAdjustment)
```

- `baseReadiness` (0~100): 기존 `calculateReadiness` 4버킷 합산 (Progress 0~30, Activity 0~25, Metadata 0~25, Type 0~20). **변경 없음.**
- `threadAdjustment` (0~20): 아래 3신호의 합. ThreadKeeper 신호로만 결정.

### threadAdjustment 신호 (총 20점)

1. **명확한 다음 액션** (0~6): 활성 thread 중 `currentNextAction`이 핀된 비율/존재에 따라 가점. 적어도 하나 존재 시 가점, 비율이 높을수록 만점에 근접.
2. **최근 thread 활동 / 활성 세션** (0~8): `mostRecentActivityAt`의 최근성과 `active` 수를 결합. 최근 활동일수록·활성 thread가 있을수록 가점.
3. **완료 thread 비율** (0~6): `completed / total` 비율에 비례.

각 신호는 사람이 읽을 수 있는 근거 문자열로 `ContinuitySummary.signals`에 기록한다 (예: `"thread: 활성 3개 중 2개에 다음 액션 핀됨 (+4)"`). 구체적 배분 곡선은 구현 시 결정하되, 합은 0~20을 넘지 않는다.

> 정확한 점수 배분(6/8/6)과 곡선은 1차 구현 후 실제 데이터로 조정한다.

## 6. Fallback & coverage

`ThreadEnricher`가 project_key별로 coverage를 판정한다.

- **live**: ThreadKeeper가 응답함 → 최신 thread로 집계, `threadAdjustment` 계산, `ThreadCache`에 저장.
- **stale**: ThreadKeeper 호출 실패(타임아웃/에러/연결 거부) → `ThreadCache`의 마지막 요약 사용. `threadAdjustment`는 캐시 기준 값. 리포트에 "N일 전 데이터" 표시. 단 캐시 나이 > `staleMaxDays`(기본 14일)이면 `unavailable`로 강등.
- **unavailable**: 캐시 없음 또는 만료 → `threadAdjustment = 0`, `summary` 없음. base 점수만 사용.

`Config.threadKeeper.enabled`가 false면 enrichment 자체를 건너뛴다 → `continuity = undefined`, 기존 동작과 완전히 동일.

## 7. project_key 매칭

- **자동(기본)**: 디렉토리명을 project_key로 사용 (예: `~/portfolio/projects/threadkeeper` → `threadkeeper`).
- **수동 오버라이드**: `Config.threadKeeper.projectKeyOverrides`에 디렉토리 path 또는 name 키로 project_key를 지정. 오버라이드가 자동값보다 우선.

## 8. 표시 (컴팩트 + 상세)

- **기본 리포트 (컴팩트)**: 프로젝트 행에
  - 점수 분해: `82 (base 71 +11)`
  - coverage 배지: `live` / `stale (3d)` / `offline`
  - 대표 thread 1줄: 제목 + 다음 액션
  - 카운트: `활성 3 / 전체 7`
- **상세 뷰**: `report --threads` 플래그 → 프로젝트별 활성 thread 전체 나열 (제목·상태·우선순위·다음 액션·마지막 활동).
- **JSON 리포트**: `continuity` 객체 전체 포함(기계 판독용).
- ThreadKeeper disabled이거나 `continuity` 없음 → thread 관련 표시는 생략, 점수는 base만 표시(기존과 동일).

## 9. 설정 & CLI

- `Config.threadKeeper` (§4 타입).
- CLI 명령(기존 `config` 명령 패턴 따름):
  - `config set threadkeeper.enabled true`
  - `config set threadkeeper.url http://localhost:8080`
  - (필요 시) override 설정 명령
- `report --threads`: 상세 뷰 플래그.

## 10. 테스트 전략

- `ThreadKeeperClient`: HTTP mock으로 정상 응답 / 타임아웃 / 네트워크 에러 / non-2xx.
- `ThreadEnricher`:
  - 신호별 `threadAdjustment` 계산 (다음 액션·최근 활동·완료 비율 각각, 합산, 20 상한).
  - coverage 전이: live → 캐시 저장, 실패 시 stale(캐시 사용), 캐시 만료 시 unavailable, 캐시 없음 시 unavailable.
  - project_key 해석: 자동(디렉토리명) + override 우선.
- `ThreadCache`: 저장/로드/만료(staleMaxDays).
- `Scanner`: TK disabled 시 `readiness === baseReadiness`이고 continuity undefined; enabled+live 시 adjustment 반영.
- 리포트 4종: continuity 있음/없음/ stale 케이스 렌더링.

## 11. 가정 / 미해결

- ThreadKeeper `GET /api/v1/threads?projectKey=...` 응답이 §4 `RawThread` 필드(특히 `currentNextAction`, `status`, `lastActivityAt`)를 포함한다고 가정. 구현 첫 단계에서 실제 응답 스키마를 확인해 맞춘다.
- "활성(active)" status 집합(IN_PROGRESS 등)의 정확한 값은 ThreadKeeper 실제 status enum 확인 후 확정.
- 점수 배분 곡선은 실제 데이터로 1차 구현 후 조정.
