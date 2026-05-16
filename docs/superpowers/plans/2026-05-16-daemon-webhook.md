# Daemon 모드 + Webhook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 미커밋 상태의 `watch`/`service` 커맨드를 커밋하고, 변경 감지 시 webhook POST를 전송하는 `WebhookNotifier`를 추가한다.

**Architecture:** `WebhookNotifier` 클래스(`src/core/WebhookNotifier.ts`)가 `ScanDiff`를 받아 변경 여부 판단과 HTTP POST 전송을 담당한다. `watch` 커맨드의 `run()` 클로저가 매 스캔 후 `HistoryStore`에서 이전 결과를 로드해 diff를 계산하고 `WebhookNotifier`를 호출한다. `webhookUrl`은 `config.json`에 선택적으로 설정한다.

**Tech Stack:** TypeScript, vitest, Node.js 내장 `fetch` (Node 18+)

---

## 변경 파일 요약

| 파일 | 작업 |
|------|------|
| `src/core/Interval.ts` | 기존 코드 — 커밋만 |
| `src/core/Interval.test.ts` | 기존 코드 — 커밋만 |
| `src/core/LaunchAgent.ts` | 기존 코드 — 커밋만 |
| `src/core/LaunchAgent.test.ts` | 기존 코드 — 커밋만 |
| `src/config/ConfigManager.ts` | 포맷팅 수정 — 커밋만 |
| `src/cli/index.ts` | `watch`/`service` 커맨드 — 커밋 후 webhook 통합 추가 |
| `src/core/ProjectModel.ts` | `Config.webhookUrl?: string` 추가 |
| `src/core/WebhookNotifier.ts` | **새 파일** — shouldNotify, notify, buildPayload |
| `src/core/WebhookNotifier.test.ts` | **새 파일** — 테스트 6개 |

---

## Task 1: 기존 작업 커밋

**Files:**
- Modify (commit): `src/core/Interval.ts`, `src/core/Interval.test.ts`
- Modify (commit): `src/core/LaunchAgent.ts`, `src/core/LaunchAgent.test.ts`
- Modify (commit): `src/config/ConfigManager.ts`
- Modify (commit): `src/cli/index.ts` (watch + service 커맨드)
- Modify (commit): `README.md`

- [ ] **Step 1: 빌드 + 테스트 확인**

```bash
cd /Users/jean325/portfolio/portfolio-tracker
npm run build 2>&1 | tail -5
npx vitest run 2>&1 | tail -8
```

Expected: 빌드 성공, 전체 테스트 PASS (현재 84개).

- [ ] **Step 2: 변경된 파일 스테이징 후 커밋**

```bash
git add src/core/Interval.ts src/core/Interval.test.ts
git add src/core/LaunchAgent.ts src/core/LaunchAgent.test.ts
git add src/config/ConfigManager.ts
git add src/cli/index.ts
git add README.md
git commit -m "feat: add watch command and macOS service management (v0.2.0)"
```

---

## Task 2: WebhookNotifier — TDD

**Files:**
- Create: `src/core/WebhookNotifier.ts`
- Create: `src/core/WebhookNotifier.test.ts`

### 타입 및 인터페이스 정의

`WebhookNotifier.ts`에서 내보낼 타입:

```ts
export interface WebhookPayload {
  scannedAt: string;           // ISO 8601
  summary: {
    total: number;
    active: number;
    avgProgress: number | null;
    avgReadiness: number;
  };
  changes: {
    added: string[];
    removed: string[];
    changed: Array<{
      name: string;
      progressBefore: number | null;
      progressAfter: number | null;
      readinessBefore: number;
      readinessAfter: number;
    }>;
  };
}
```

- [ ] **Step 1: shouldNotify 테스트 작성 (새 프로젝트 → true)**

`src/core/WebhookNotifier.test.ts` 생성:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { WebhookNotifier } from "./WebhookNotifier.js";
import type { ScanDiff } from "./TrendAnalyzer.js";
import type { ScanResult } from "./ProjectModel.js";

function makeDiff(overrides: Partial<ScanDiff> = {}): ScanDiff {
  const emptySummary: ScanResult["summary"] = {
    total: 0, active: 0, avgProgress: null, avgReadiness: 0,
    byPriority: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    byType: { node: 0, python: 0, dart: 0, java: 0, kotlin: 0, go: 0, rust: 0, unknown: 0 },
  };
  return {
    fromDate: new Date("2026-01-01"),
    toDate: new Date("2026-01-02"),
    summary: {
      before: emptySummary,
      after: emptySummary,
      changes: { total: 0, active: 0, avgProgress: null, avgReadiness: 0 },
    },
    projects: [],
    ...overrides,
  };
}

describe("WebhookNotifier.shouldNotify", () => {
  it("새 프로젝트가 있으면 true를 반환한다", () => {
    const diff = makeDiff({
      projects: [
        { name: "new-proj", before: null, after: {} as any,
          status: "new", progressChange: null, readinessChange: 50, activityChange: 0 },
      ],
    });
    expect(WebhookNotifier.shouldNotify(diff)).toBe(true);
  });
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

```bash
npx vitest run src/core/WebhookNotifier.test.ts 2>&1 | tail -10
```

Expected: `WebhookNotifier` not found 또는 `shouldNotify` not a function으로 FAIL.

- [ ] **Step 3: WebhookNotifier 뼈대 + shouldNotify 구현**

`src/core/WebhookNotifier.ts` 생성:

```ts
import type { ScanDiff, ProjectChange } from "./TrendAnalyzer.js";
import type { ScanResult } from "./ProjectModel.js";

export interface WebhookPayload {
  scannedAt: string;
  summary: {
    total: number;
    active: number;
    avgProgress: number | null;
    avgReadiness: number;
  };
  changes: {
    added: string[];
    removed: string[];
    changed: Array<{
      name: string;
      progressBefore: number | null;
      progressAfter: number | null;
      readinessBefore: number;
      readinessAfter: number;
    }>;
  };
}

const PROGRESS_CHANGE_THRESHOLD = 5;

export class WebhookNotifier {
  constructor(private readonly url: string) {}

  /**
   * diff에 유의미한 변경이 있으면 true.
   * - 새 프로젝트 추가됨
   * - 프로젝트 삭제됨
   * - 진행률 변화 절댓값 >= 5%p
   */
  static shouldNotify(diff: ScanDiff): boolean {
    return diff.projects.some(
      (p) =>
        p.status === "new" ||
        p.status === "removed" ||
        (p.progressChange !== null &&
          Math.abs(p.progressChange) >= PROGRESS_CHANGE_THRESHOLD),
    );
  }

  static buildPayload(diff: ScanDiff, after: ScanResult): WebhookPayload {
    const changed = diff.projects
      .filter(
        (p): p is ProjectChange & { status: "changed" } =>
          p.status === "changed" &&
          p.progressChange !== null &&
          Math.abs(p.progressChange) >= PROGRESS_CHANGE_THRESHOLD,
      )
      .map((p) => ({
        name: p.name,
        progressBefore: p.before?.progress.percentage ?? null,
        progressAfter: p.after?.progress.percentage ?? null,
        readinessBefore: p.before?.readiness ?? 0,
        readinessAfter: p.after?.readiness ?? 0,
      }));

    return {
      scannedAt: after.scannedAt.toISOString(),
      summary: {
        total: after.summary.total,
        active: after.summary.active,
        avgProgress: after.summary.avgProgress,
        avgReadiness: after.summary.avgReadiness,
      },
      changes: {
        added: diff.projects.filter((p) => p.status === "new").map((p) => p.name),
        removed: diff.projects.filter((p) => p.status === "removed").map((p) => p.name),
        changed,
      },
    };
  }

  async notify(payload: WebhookPayload): Promise<void> {
    await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }
}
```

- [ ] **Step 4: 테스트 실행해서 첫 테스트 통과 확인**

```bash
npx vitest run src/core/WebhookNotifier.test.ts 2>&1 | tail -10
```

Expected: 1개 PASS.

- [ ] **Step 5: 나머지 shouldNotify 테스트 추가**

```ts
  it("삭제된 프로젝트가 있으면 true를 반환한다", () => {
    const diff = makeDiff({
      projects: [
        { name: "gone-proj", before: {} as any, after: null,
          status: "removed", progressChange: null, readinessChange: -50, activityChange: 0 },
      ],
    });
    expect(WebhookNotifier.shouldNotify(diff)).toBe(true);
  });

  it("진행률 변화가 5%p 이상이면 true를 반환한다", () => {
    const diff = makeDiff({
      projects: [
        { name: "proj", before: {} as any, after: {} as any,
          status: "changed", progressChange: 5, readinessChange: 0, activityChange: 0 },
      ],
    });
    expect(WebhookNotifier.shouldNotify(diff)).toBe(true);
  });

  it("진행률 변화가 5%p 미만이고 추가/삭제 없으면 false를 반환한다", () => {
    const diff = makeDiff({
      projects: [
        { name: "proj", before: {} as any, after: {} as any,
          status: "changed", progressChange: 4, readinessChange: 0, activityChange: 0 },
      ],
    });
    expect(WebhookNotifier.shouldNotify(diff)).toBe(false);
  });

  it("변경이 없으면 false를 반환한다", () => {
    const diff = makeDiff();
    expect(WebhookNotifier.shouldNotify(diff)).toBe(false);
  });
});
```

```bash
npx vitest run src/core/WebhookNotifier.test.ts 2>&1 | tail -10
```

Expected: 5개 PASS.

- [ ] **Step 6: notify 테스트 추가 (fetch mock)**

```ts
describe("WebhookNotifier.notify", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("올바른 URL과 payload로 fetch POST를 호출한다", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const notifier = new WebhookNotifier("https://example.com/hook");
    const payload: import("./WebhookNotifier.js").WebhookPayload = {
      scannedAt: "2026-01-01T00:00:00.000Z",
      summary: { total: 1, active: 1, avgProgress: 50, avgReadiness: 60 },
      changes: { added: ["proj-a"], removed: [], changed: [] },
    };

    await notifier.notify(payload);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith("https://example.com/hook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  it("fetch 실패 시 오류를 throw한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const notifier = new WebhookNotifier("https://example.com/hook");
    await expect(
      notifier.notify({
        scannedAt: "2026-01-01T00:00:00.000Z",
        summary: { total: 0, active: 0, avgProgress: null, avgReadiness: 0 },
        changes: { added: [], removed: [], changed: [] },
      }),
    ).rejects.toThrow("network error");
  });
});
```

```bash
npx vitest run src/core/WebhookNotifier.test.ts 2>&1 | tail -10
```

Expected: 7개 PASS.

- [ ] **Step 7: 커밋**

```bash
git add src/core/WebhookNotifier.ts src/core/WebhookNotifier.test.ts
git commit -m "feat: add WebhookNotifier with shouldNotify and notify"
```

---

## Task 3: webhook을 watch 커맨드에 통합

**Files:**
- Modify: `src/core/ProjectModel.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Config에 webhookUrl 추가**

`src/core/ProjectModel.ts`에서 `Config` 인터페이스 수정:

```ts
export interface Config {
  projectDirs: string[];
  scanInterval?: number;
  excludePatterns?: string[];
  webhookUrl?: string;   // 추가
}
```

- [ ] **Step 2: WebhookNotifier import 추가**

`src/cli/index.ts` 상단의 import 블록에 추가:

```ts
import { WebhookNotifier } from "../core/WebhookNotifier.js";
```

기존 import 목록 (대략 line 1-20) 중 core imports 그룹에 추가. `TrendAnalyzer` import 바로 아래에 넣는다:
```ts
import { TrendAnalyzer } from "../core/TrendAnalyzer.js";
import { WebhookNotifier } from "../core/WebhookNotifier.js";
```

- [ ] **Step 3: watch 커맨드의 run() 클로저에 webhook 호출 추가**

`src/cli/index.ts`의 `watch` 커맨드 `run()` 클로저에서 스캔 완료 후 webhook 호출 추가.

기존 `run()` 내부 (lines 147-175):
```ts
      const run = async () => {
        if (running) {
          console.log(
            chalk.gray(
              `[${formatDateTime(new Date())}] 이전 스캔이 아직 실행 중이라 건너뜁니다.`,
            ),
          );
          return;
        }

        running = true;
        try {
          const result = await runAndSaveScan();
          console.log(
            chalk.green(
              `[${formatDateTime(result.scannedAt)}] ${result.projects.length}개 프로젝트 스캔 완료`,
            ),
          );
          console.log(
            chalk.gray(
              `  평균 진행률: ${formatProgress(result.summary.avgProgress)}, 준비도: ${result.summary.avgReadiness}%`,
            ),
          );
        } catch (error) {
          console.error(chalk.red("자동 스캔 실패:"), error);
        } finally {
          running = false;
        }
      };
```

변경 후:
```ts
      const run = async () => {
        if (running) {
          console.log(
            chalk.gray(
              `[${formatDateTime(new Date())}] 이전 스캔이 아직 실행 중이라 건너뜁니다.`,
            ),
          );
          return;
        }

        running = true;
        try {
          const result = await runAndSaveScan();
          console.log(
            chalk.green(
              `[${formatDateTime(result.scannedAt)}] ${result.projects.length}개 프로젝트 스캔 완료`,
            ),
          );
          console.log(
            chalk.gray(
              `  평균 진행률: ${formatProgress(result.summary.avgProgress)}, 준비도: ${result.summary.avgReadiness}%`,
            ),
          );

          // webhook 알림
          if (config.webhookUrl) {
            try {
              const historyStore = new HistoryStore();
              const recentResults = await historyStore.loadRecent(2);
              if (recentResults.length >= 2) {
                const diff = TrendAnalyzer.diff(recentResults[1], recentResults[0]);
                if (WebhookNotifier.shouldNotify(diff)) {
                  const notifier = new WebhookNotifier(config.webhookUrl);
                  await notifier.notify(WebhookNotifier.buildPayload(diff, result));
                  console.log(chalk.gray("  [webhook] 변경 알림 전송 완료"));
                }
              }
            } catch (webhookError) {
              console.warn(
                chalk.yellow(
                  `⚠ Webhook 전송 실패: ${webhookError instanceof Error ? webhookError.message : webhookError}`,
                ),
              );
            }
          }
        } catch (error) {
          console.error(chalk.red("자동 스캔 실패:"), error);
        } finally {
          running = false;
        }
      };
```

Note: `config`는 이미 watch action 스코프에서 `const config = await configManager.load();`로 선언되어 있어 `run()` 클로저에서 접근 가능하다. `HistoryStore`는 이미 import되어 있다.

- [ ] **Step 4: 빌드 + 전체 테스트 확인**

```bash
npm run build 2>&1 | tail -5
npx vitest run 2>&1 | tail -8
```

Expected: 빌드 성공, 전체 테스트 PASS (기존 84개 + 신규 7개 = 91개).

- [ ] **Step 5: 커밋**

```bash
git add src/core/ProjectModel.ts src/cli/index.ts
git commit -m "feat: integrate webhook notification into watch command"
```

---

## 완료 기준

- `npx vitest run` — 전체 통과
- `npm run build` — 오류 없음
- `portfolio-tracker watch --interval 5m` — 포그라운드에서 주기적 스캔 실행
- `portfolio-tracker service install --interval 1h` — macOS launchd plist 생성
- `config.json`에 `webhookUrl` 추가 시 변경 감지 → POST 전송
- `webhookUrl` 미설정 시 webhook 스킵, 정상 동작
