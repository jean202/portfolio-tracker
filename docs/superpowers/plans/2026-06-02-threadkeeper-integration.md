# ThreadKeeper Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold ThreadKeeper thread signals into portfolio-tracker's readiness score as a separately-visible `threadAdjustment`, with live/stale/unavailable coverage and a cache fallback, and surface thread context in all four reports.

**Architecture:** A two-phase scan: the existing synchronous filesystem scan produces a stable `baseReadiness`; a new asynchronous enrichment pass fetches threads from ThreadKeeper over REST, groups them by `projectKey`, computes a 0–20 `threadAdjustment` from three signals, and sets `readiness = min(100, baseReadiness + threadAdjustment)`. ThreadKeeper is an optional read-only data source: when unreachable, the enricher falls back to a local cache; when no cache exists, the adjustment is 0 and the base score is untouched.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Node 20 global `fetch`/`AbortController`, vitest, commander, cli-table3, chalk.

---

## Key Facts (verified against both repos)

- ThreadKeeper `GET /api/v1/threads` returns **all** threads as a JSON array with **no query filter** (`ThreadController.listThreads()` takes no params). Group by `projectKey` **client-side**.
- `ThreadResponse` fields: `id` (number), `projectKey`, `title`, `status`, `priority`, `originalIntent`, `currentNextAction`, `driftStatus`, `lastActivityAt` (ISO instant). We ignore `driftStatus` everywhere.
- `ThreadStatus` enum values: `ACTIVE`, `PAUSED`, `BLOCKED`, `COMPLETED`. "active" for our purposes means `status === "ACTIVE"`; "completed" means `status === "COMPLETED"`.
- ThreadKeeper default base URL: `http://localhost:8080`.
- portfolio-tracker uses ESM with explicit `.js` suffixes in imports, vitest for tests, and `config.json` in `process.cwd()` via `ConfigManager`.

## File Structure

- Create `src/core/threadScoring.ts` — pure functions: `resolveProjectKey`, `summarizeThreads`, `computeThreadAdjustment`. No I/O. Easiest to test.
- Create `src/core/ThreadKeeperClient.ts` — REST client: `fetchAllThreads()`. Injectable `fetchFn` for tests.
- Create `src/storage/ThreadCache.ts` — persists last-known `ThreadSummary` per `projectKey` to `.portfolio-tracker/thread-cache.json`.
- Create `src/core/ThreadEnricher.ts` — orchestrates client + cache + scoring; sets `project.continuity` and final `project.readiness`.
- Modify `src/core/ProjectModel.ts` — add types (`RawThread`, `ThreadSummary`, `ContinuitySummary`, `ThreadKeeperConfig`, `ThreadCoverage`) and fields (`Project.baseReadiness`, `Project.continuity`, `Config.threadKeeper`).
- Modify `src/core/Scanner.ts` — set `baseReadiness` in `analyzeProject`; run enrichment in `scan()` when enabled.
- Modify `src/report/MarkdownReport.ts`, `src/report/HtmlReport.ts`, `src/cli/index.ts` — render readiness as `base+delta` + coverage badge + thread context; add `report --threads` detail view.
- `src/report/JsonReport.ts` needs no code change (it serializes the whole `Project`), but gets a test asserting `continuity` is present.

---

## Task 1: Types in ProjectModel

**Files:**
- Modify: `src/core/ProjectModel.ts`

- [ ] **Step 1: Add new types and fields**

Add these exported types at the end of `src/core/ProjectModel.ts`:

```ts
export type ThreadCoverage = "live" | "stale" | "unavailable";

// Mirrors ThreadKeeper GET /api/v1/threads response items (ThreadResponse).
export interface RawThread {
  id: number;
  projectKey: string;
  title: string;
  status: string; // ACTIVE | PAUSED | BLOCKED | COMPLETED
  priority: string; // CRITICAL | HIGH | MEDIUM | LOW
  originalIntent?: string | null;
  currentNextAction?: string | null;
  driftStatus?: string | null; // present in API, intentionally unused
  lastActivityAt?: string | null; // ISO timestamp
}

export interface ThreadSummaryItem {
  title: string;
  status: string;
  priority: string;
  currentNextAction?: string | null;
  lastActivityAt?: string | null;
}

export interface ThreadSummary {
  projectKey: string;
  total: number;
  active: number;
  completed: number;
  representative?: ThreadSummaryItem;
  activeThreads: ThreadSummaryItem[];
  mostRecentActivityAt?: string | null;
}

export interface ContinuitySummary {
  coverage: ThreadCoverage;
  summary?: ThreadSummary; // undefined when coverage === "unavailable"
  threadAdjustment: number; // 0-20
  signals: string[];
  fetchedAt?: string; // set when coverage === "stale"
  ageDays?: number; // set when coverage === "stale"
}

export interface ThreadKeeperConfig {
  enabled?: boolean; // default false
  baseUrl?: string; // default "http://localhost:8080"
  timeoutMs?: number; // default 2000
  staleMaxDays?: number; // default 14
  projectKeyOverrides?: Record<string, string>; // dir path OR dir name -> projectKey
}
```

In the `Project` interface, add the `baseReadiness` and `continuity` fields (keep existing `readiness`):

```ts
  readiness: number; // 0-100: final score = min(100, baseReadiness + threadAdjustment)
  baseReadiness: number; // 0-100: filesystem-only score, never affected by ThreadKeeper
  continuity?: ContinuitySummary; // populated by ThreadEnricher when enabled
```

In the `Config` interface, add:

```ts
  threadKeeper?: ThreadKeeperConfig;
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `Scanner.ts` (because `analyzeProject` does not yet set `baseReadiness`). That is expected and fixed in Task 6. If there are errors in any other file, fix the type definitions.

- [ ] **Step 3: Commit**

```bash
git add src/core/ProjectModel.ts
git commit -m "feat: add ThreadKeeper integration types to ProjectModel"
```

---

## Task 2: Pure scoring functions — resolveProjectKey

**Files:**
- Create: `src/core/threadScoring.ts`
- Test: `src/core/threadScoring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/threadScoring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveProjectKey } from "./threadScoring.js";

describe("resolveProjectKey", () => {
  it("defaults to the project directory name", () => {
    expect(
      resolveProjectKey({ name: "threadkeeper", path: "/Users/x/projects/threadkeeper" }),
    ).toBe("threadkeeper");
  });

  it("prefers an override keyed by path", () => {
    expect(
      resolveProjectKey(
        { name: "tk", path: "/Users/x/projects/tk" },
        { "/Users/x/projects/tk": "threadkeeper" },
      ),
    ).toBe("threadkeeper");
  });

  it("falls back to an override keyed by name when path has no override", () => {
    expect(
      resolveProjectKey({ name: "tk", path: "/abs/tk" }, { tk: "threadkeeper" }),
    ).toBe("threadkeeper");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/threadScoring.test.ts`
Expected: FAIL — cannot find module `./threadScoring.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/threadScoring.ts`:

```ts
export function resolveProjectKey(
  project: { name: string; path: string },
  overrides?: Record<string, string>,
): string {
  if (overrides) {
    if (overrides[project.path]) return overrides[project.path];
    if (overrides[project.name]) return overrides[project.name];
  }
  return project.name;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/threadScoring.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/threadScoring.ts src/core/threadScoring.test.ts
git commit -m "feat: add resolveProjectKey for ThreadKeeper matching"
```

---

## Task 3: Pure scoring functions — summarizeThreads

**Files:**
- Modify: `src/core/threadScoring.ts`
- Test: `src/core/threadScoring.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/core/threadScoring.test.ts`:

```ts
import { summarizeThreads } from "./threadScoring.js";
import type { RawThread } from "./ProjectModel.js";

function thread(over: Partial<RawThread>): RawThread {
  return {
    id: 1,
    projectKey: "pt",
    title: "t",
    status: "ACTIVE",
    priority: "MEDIUM",
    ...over,
  };
}

describe("summarizeThreads", () => {
  it("filters by projectKey and counts active/completed", () => {
    const threads = [
      thread({ id: 1, projectKey: "pt", status: "ACTIVE" }),
      thread({ id: 2, projectKey: "pt", status: "COMPLETED" }),
      thread({ id: 3, projectKey: "pt", status: "PAUSED" }),
      thread({ id: 4, projectKey: "other", status: "ACTIVE" }),
    ];
    const s = summarizeThreads("pt", threads);
    expect(s.total).toBe(3);
    expect(s.active).toBe(1);
    expect(s.completed).toBe(1);
    expect(s.activeThreads).toHaveLength(1);
  });

  it("picks the most recently active thread as representative", () => {
    const threads = [
      thread({ id: 1, title: "old", status: "ACTIVE", lastActivityAt: "2026-05-01T00:00:00Z" }),
      thread({ id: 2, title: "new", status: "ACTIVE", lastActivityAt: "2026-06-01T00:00:00Z" }),
    ];
    const s = summarizeThreads("pt", threads);
    expect(s.representative?.title).toBe("new");
    expect(s.mostRecentActivityAt).toBe("2026-06-01T00:00:00Z");
  });

  it("falls back to highest-priority thread when none are active", () => {
    const threads = [
      thread({ id: 1, title: "low", status: "COMPLETED", priority: "LOW" }),
      thread({ id: 2, title: "crit", status: "COMPLETED", priority: "CRITICAL" }),
    ];
    const s = summarizeThreads("pt", threads);
    expect(s.active).toBe(0);
    expect(s.representative?.title).toBe("crit");
  });

  it("returns an empty summary when no threads match", () => {
    const s = summarizeThreads("pt", [thread({ projectKey: "other" })]);
    expect(s.total).toBe(0);
    expect(s.representative).toBeUndefined();
    expect(s.activeThreads).toEqual([]);
    expect(s.mostRecentActivityAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/threadScoring.test.ts`
Expected: FAIL — `summarizeThreads` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/core/threadScoring.ts`:

```ts
import type { RawThread, ThreadSummary, ThreadSummaryItem } from "./ProjectModel.js";

const PRIORITY_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

function activityMs(t: RawThread): number {
  return t.lastActivityAt ? new Date(t.lastActivityAt).getTime() : 0;
}

function toItem(t: RawThread): ThreadSummaryItem {
  return {
    title: t.title,
    status: t.status,
    priority: t.priority,
    currentNextAction: t.currentNextAction ?? null,
    lastActivityAt: t.lastActivityAt ?? null,
  };
}

export function summarizeThreads(
  projectKey: string,
  threads: RawThread[],
): ThreadSummary {
  const forProject = threads.filter((t) => t.projectKey === projectKey);
  const activeRaw = forProject.filter((t) => t.status === "ACTIVE");
  const completed = forProject.filter((t) => t.status === "COMPLETED").length;

  const byRecency = [...activeRaw].sort((a, b) => activityMs(b) - activityMs(a));
  let representativeRaw: RawThread | undefined = byRecency[0];
  if (!representativeRaw && forProject.length > 0) {
    representativeRaw = [...forProject].sort(
      (a, b) => (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0),
    )[0];
  }

  const mostRecentActivityAt = forProject.reduce<string | null>((acc, t) => {
    if (!t.lastActivityAt) return acc;
    if (!acc || new Date(t.lastActivityAt) > new Date(acc)) return t.lastActivityAt;
    return acc;
  }, null);

  return {
    projectKey,
    total: forProject.length,
    active: activeRaw.length,
    completed,
    representative: representativeRaw ? toItem(representativeRaw) : undefined,
    activeThreads: activeRaw.map(toItem),
    mostRecentActivityAt,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/threadScoring.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/threadScoring.ts src/core/threadScoring.test.ts
git commit -m "feat: add summarizeThreads aggregation"
```

---

## Task 4: Pure scoring functions — computeThreadAdjustment

**Files:**
- Modify: `src/core/threadScoring.ts`
- Test: `src/core/threadScoring.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/core/threadScoring.test.ts`:

```ts
import { computeThreadAdjustment } from "./threadScoring.js";
import type { ThreadSummary } from "./ProjectModel.js";

function summary(over: Partial<ThreadSummary>): ThreadSummary {
  return {
    projectKey: "pt",
    total: 0,
    active: 0,
    completed: 0,
    activeThreads: [],
    mostRecentActivityAt: null,
    ...over,
  };
}

describe("computeThreadAdjustment", () => {
  const now = new Date("2026-06-02T00:00:00Z");

  it("returns 0 with no signals for an empty summary", () => {
    const { adjustment, signals } = computeThreadAdjustment(summary({}), now);
    expect(adjustment).toBe(0);
    expect(signals).toEqual([]);
  });

  it("awards next-action points when active threads have a pinned next action", () => {
    const s = summary({
      total: 2,
      active: 2,
      activeThreads: [
        { title: "a", status: "ACTIVE", priority: "HIGH", currentNextAction: "do x", lastActivityAt: null },
        { title: "b", status: "ACTIVE", priority: "LOW", currentNextAction: null, lastActivityAt: null },
      ],
    });
    const { adjustment, signals } = computeThreadAdjustment(s, now);
    // 1 of 2 active has next action -> round(0.5*6)=3
    expect(adjustment).toBeGreaterThanOrEqual(3);
    expect(signals.some((x) => x.includes("다음 액션"))).toBe(true);
  });

  it("awards recency points for very recent activity", () => {
    const s = summary({
      total: 1,
      active: 1,
      activeThreads: [{ title: "a", status: "ACTIVE", priority: "HIGH", currentNextAction: null, lastActivityAt: "2026-06-01T00:00:00Z" }],
      mostRecentActivityAt: "2026-06-01T00:00:00Z", // 1 day ago -> 5 recency + 2 active = 7
    });
    const { adjustment } = computeThreadAdjustment(s, now);
    expect(adjustment).toBe(7);
  });

  it("awards completed-ratio points", () => {
    const s = summary({ total: 4, active: 0, completed: 4 });
    const { adjustment, signals } = computeThreadAdjustment(s, now);
    // ratio 1.0 -> round(1*6)=6
    expect(adjustment).toBe(6);
    expect(signals.some((x) => x.includes("완료"))).toBe(true);
  });

  it("caps the total adjustment at 20", () => {
    const active = Array.from({ length: 5 }, (_, i) => ({
      title: `t${i}`,
      status: "ACTIVE",
      priority: "HIGH",
      currentNextAction: "go",
      lastActivityAt: "2026-06-01T00:00:00Z",
    }));
    const s = summary({
      total: 10,
      active: 5,
      completed: 5,
      activeThreads: active,
      mostRecentActivityAt: "2026-06-01T00:00:00Z",
    });
    const { adjustment } = computeThreadAdjustment(s, now);
    expect(adjustment).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/threadScoring.test.ts`
Expected: FAIL — `computeThreadAdjustment` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/core/threadScoring.ts`:

```ts
export function computeThreadAdjustment(
  summary: ThreadSummary,
  now: Date = new Date(),
): { adjustment: number; signals: string[] } {
  const signals: string[] = [];
  let adjustment = 0;

  // Signal 1: clear next action present (0-6)
  const activeWithNext = summary.activeThreads.filter(
    (t) => t.currentNextAction && t.currentNextAction.trim().length > 0,
  ).length;
  if (summary.active > 0 && activeWithNext > 0) {
    const pts = Math.round((activeWithNext / summary.active) * 6);
    if (pts > 0) {
      adjustment += pts;
      signals.push(`thread: 활성 ${summary.active}개 중 ${activeWithNext}개에 다음 액션 핀됨 (+${pts})`);
    }
  }

  // Signal 2: recent activity / active sessions (0-8)
  let recencyPts = 0;
  if (summary.mostRecentActivityAt) {
    const days = (now.getTime() - new Date(summary.mostRecentActivityAt).getTime()) / 86_400_000;
    if (days <= 3) recencyPts = 5;
    else if (days <= 7) recencyPts = 3;
    else if (days <= 30) recencyPts = 1;
  }
  let activePts = 0;
  if (summary.active >= 3) activePts = 3;
  else if (summary.active >= 1) activePts = 2;
  const s2 = Math.min(8, recencyPts + activePts);
  if (s2 > 0) {
    adjustment += s2;
    signals.push(`thread: 최근 활동/활성 세션 ${summary.active}개 (+${s2})`);
  }

  // Signal 3: completed ratio (0-6)
  if (summary.total > 0 && summary.completed > 0) {
    const pts = Math.round((summary.completed / summary.total) * 6);
    if (pts > 0) {
      adjustment += pts;
      signals.push(`thread: 완료 ${summary.completed}/${summary.total} (+${pts})`);
    }
  }

  return { adjustment: Math.min(20, adjustment), signals };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/threadScoring.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/threadScoring.ts src/core/threadScoring.test.ts
git commit -m "feat: add computeThreadAdjustment scoring (0-20, 3 signals)"
```

---

## Task 5: ThreadKeeperClient

**Files:**
- Create: `src/core/ThreadKeeperClient.ts`
- Test: `src/core/ThreadKeeperClient.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/ThreadKeeperClient.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { ThreadKeeperClient } from "./ThreadKeeperClient.js";

describe("ThreadKeeperClient", () => {
  it("fetches and returns the threads array from /api/v1/threads", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: 1, projectKey: "pt", title: "t", status: "ACTIVE", priority: "HIGH" }],
    });
    const client = new ThreadKeeperClient("http://localhost:8080", 2000, fetchFn as unknown as typeof fetch);
    const threads = await client.fetchAllThreads();
    expect(threads).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/threads",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("strips a trailing slash from baseUrl", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    const client = new ThreadKeeperClient("http://localhost:8080/", 2000, fetchFn as unknown as typeof fetch);
    await client.fetchAllThreads();
    expect(fetchFn).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/threads",
      expect.anything(),
    );
  });

  it("throws on a non-2xx response", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const client = new ThreadKeeperClient("http://localhost:8080", 2000, fetchFn as unknown as typeof fetch);
    await expect(client.fetchAllThreads()).rejects.toThrow("503");
  });

  it("throws when fetch rejects (connection refused)", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new ThreadKeeperClient("http://localhost:8080", 2000, fetchFn as unknown as typeof fetch);
    await expect(client.fetchAllThreads()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/ThreadKeeperClient.test.ts`
Expected: FAIL — cannot find module `./ThreadKeeperClient.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/ThreadKeeperClient.ts`:

```ts
import type { RawThread } from "./ProjectModel.js";

export class ThreadKeeperClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number = 2000,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async fetchAllThreads(): Promise<RawThread[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = `${this.baseUrl.replace(/\/$/, "")}/api/v1/threads`;
      const res = await this.fetchFn(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`ThreadKeeper responded with ${res.status}`);
      }
      return (await res.json()) as RawThread[];
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/ThreadKeeperClient.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/ThreadKeeperClient.ts src/core/ThreadKeeperClient.test.ts
git commit -m "feat: add ThreadKeeperClient REST client"
```

---

## Task 6: ThreadCache

**Files:**
- Create: `src/storage/ThreadCache.ts`
- Test: `src/storage/ThreadCache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/storage/ThreadCache.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { ThreadCache } from "./ThreadCache.js";
import type { ThreadSummary } from "../core/ProjectModel.js";

function summary(): ThreadSummary {
  return {
    projectKey: "pt",
    total: 1,
    active: 1,
    completed: 0,
    activeThreads: [],
    mostRecentActivityAt: null,
  };
}

describe("ThreadCache", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "tk-cache-"));
    file = path.join(dir, "thread-cache.json");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns null for an unknown key when no file exists", async () => {
    const cache = new ThreadCache(file);
    expect(await cache.get("pt")).toBeNull();
  });

  it("saves and reloads a summary", async () => {
    const cache = new ThreadCache(file);
    await cache.save("pt", summary(), "2026-06-01T00:00:00Z");
    const entry = await cache.get("pt");
    expect(entry?.fetchedAt).toBe("2026-06-01T00:00:00Z");
    expect(entry?.summary.projectKey).toBe("pt");
  });

  it("preserves other keys when saving a new one", async () => {
    const cache = new ThreadCache(file);
    await cache.save("a", summary(), "2026-06-01T00:00:00Z");
    await cache.save("b", summary(), "2026-06-02T00:00:00Z");
    expect(await cache.get("a")).not.toBeNull();
    expect(await cache.get("b")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/storage/ThreadCache.test.ts`
Expected: FAIL — cannot find module `./ThreadCache.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/storage/ThreadCache.ts`:

```ts
import fs from "fs/promises";
import path from "path";
import type { ThreadSummary } from "../core/ProjectModel.js";

export interface ThreadCacheEntry {
  summary: ThreadSummary;
  fetchedAt: string; // ISO timestamp
}

interface ThreadCacheData {
  entries: Record<string, ThreadCacheEntry>;
}

const DEFAULT_FILE = path.join(process.cwd(), ".portfolio-tracker", "thread-cache.json");

export class ThreadCache {
  constructor(private readonly file: string = DEFAULT_FILE) {}

  private async load(): Promise<ThreadCacheData> {
    try {
      const content = await fs.readFile(this.file, "utf-8");
      return JSON.parse(content) as ThreadCacheData;
    } catch {
      return { entries: {} };
    }
  }

  async get(projectKey: string): Promise<ThreadCacheEntry | null> {
    const data = await this.load();
    return data.entries[projectKey] ?? null;
  }

  async save(projectKey: string, summary: ThreadSummary, fetchedAt: string): Promise<void> {
    const data = await this.load();
    data.entries[projectKey] = { summary, fetchedAt };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(data, null, 2), "utf-8");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/storage/ThreadCache.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/storage/ThreadCache.ts src/storage/ThreadCache.test.ts
git commit -m "feat: add ThreadCache for stale-fallback persistence"
```

---

## Task 7: ThreadEnricher

**Files:**
- Create: `src/core/ThreadEnricher.ts`
- Test: `src/core/ThreadEnricher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/ThreadEnricher.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { ThreadEnricher } from "./ThreadEnricher.js";
import type { Project, RawThread, ThreadSummary } from "./ProjectModel.js";
import type { ThreadKeeperClient } from "./ThreadKeeperClient.js";
import type { ThreadCache, ThreadCacheEntry } from "../storage/ThreadCache.js";

function project(over: Partial<Project> = {}): Project {
  return {
    id: "pt",
    name: "pt",
    path: "/abs/pt",
    type: "node",
    progress: { percentage: 50, source: "readme", confidence: "medium", signals: [], lastUpdated: new Date() },
    activity: { lastCommitDate: null, commitsInLastWeek: 0, isActive: false, daysSinceLastCommit: 10 },
    metadata: { description: "", stack: [], hasReadme: true, hasClaude: false, hasGit: true },
    readiness: 70,
    baseReadiness: 70,
    scannedAt: new Date(),
    ...over,
  };
}

function fakeClient(threads: RawThread[] | Error): ThreadKeeperClient {
  return {
    fetchAllThreads: threads instanceof Error
      ? vi.fn().mockRejectedValue(threads)
      : vi.fn().mockResolvedValue(threads),
  } as unknown as ThreadKeeperClient;
}

function fakeCache(initial: Record<string, ThreadCacheEntry> = {}): ThreadCache {
  const store = { ...initial };
  return {
    get: vi.fn(async (k: string) => store[k] ?? null),
    save: vi.fn(async (k: string, summary: ThreadSummary, fetchedAt: string) => {
      store[k] = { summary, fetchedAt };
    }),
  } as unknown as ThreadCache;
}

const NOW = new Date("2026-06-02T00:00:00Z");

describe("ThreadEnricher", () => {
  it("sets coverage=live and adds adjustment to baseReadiness when ThreadKeeper responds", async () => {
    const threads: RawThread[] = [
      { id: 1, projectKey: "pt", title: "t", status: "COMPLETED", priority: "HIGH" },
    ];
    const cache = fakeCache();
    const enricher = new ThreadEnricher({ enabled: true }, fakeClient(threads), cache);
    const p = project();
    await enricher.enrichWithThreads([p], NOW);
    expect(p.continuity?.coverage).toBe("live");
    expect(p.continuity!.threadAdjustment).toBeGreaterThan(0);
    expect(p.readiness).toBe(Math.min(100, 70 + p.continuity!.threadAdjustment));
    expect(cache.save).toHaveBeenCalled();
  });

  it("falls back to coverage=stale with cached data when fetch fails and cache is fresh", async () => {
    const cachedSummary: ThreadSummary = {
      projectKey: "pt", total: 1, active: 0, completed: 1, activeThreads: [], mostRecentActivityAt: null,
    };
    const cache = fakeCache({ pt: { summary: cachedSummary, fetchedAt: "2026-06-01T00:00:00Z" } });
    const enricher = new ThreadEnricher({ enabled: true, staleMaxDays: 14 }, fakeClient(new Error("down")), cache);
    const p = project();
    await enricher.enrichWithThreads([p], NOW);
    expect(p.continuity?.coverage).toBe("stale");
    expect(p.continuity?.ageDays).toBe(1);
    expect(p.continuity!.threadAdjustment).toBeGreaterThan(0);
  });

  it("uses coverage=unavailable when fetch fails and cache is older than staleMaxDays", async () => {
    const cachedSummary: ThreadSummary = {
      projectKey: "pt", total: 1, active: 0, completed: 1, activeThreads: [], mostRecentActivityAt: null,
    };
    const cache = fakeCache({ pt: { summary: cachedSummary, fetchedAt: "2026-01-01T00:00:00Z" } });
    const enricher = new ThreadEnricher({ enabled: true, staleMaxDays: 14 }, fakeClient(new Error("down")), cache);
    const p = project();
    await enricher.enrichWithThreads([p], NOW);
    expect(p.continuity?.coverage).toBe("unavailable");
    expect(p.continuity!.threadAdjustment).toBe(0);
    expect(p.readiness).toBe(70);
  });

  it("uses coverage=unavailable when fetch fails and no cache exists", async () => {
    const enricher = new ThreadEnricher({ enabled: true }, fakeClient(new Error("down")), fakeCache());
    const p = project();
    await enricher.enrichWithThreads([p], NOW);
    expect(p.continuity?.coverage).toBe("unavailable");
    expect(p.readiness).toBe(70);
  });

  it("resolves projectKey via overrides", async () => {
    const threads: RawThread[] = [
      { id: 1, projectKey: "threadkeeper", title: "t", status: "ACTIVE", priority: "HIGH", currentNextAction: "go", lastActivityAt: "2026-06-01T00:00:00Z" },
    ];
    const enricher = new ThreadEnricher(
      { enabled: true, projectKeyOverrides: { "/abs/pt": "threadkeeper" } },
      fakeClient(threads),
      fakeCache(),
    );
    const p = project();
    await enricher.enrichWithThreads([p], NOW);
    expect(p.continuity?.summary?.projectKey).toBe("threadkeeper");
    expect(p.continuity!.threadAdjustment).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/ThreadEnricher.test.ts`
Expected: FAIL — cannot find module `./ThreadEnricher.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/ThreadEnricher.ts`:

```ts
import type { ContinuitySummary, Project, RawThread, ThreadKeeperConfig } from "./ProjectModel.js";
import type { ThreadKeeperClient } from "./ThreadKeeperClient.js";
import type { ThreadCache } from "../storage/ThreadCache.js";
import { computeThreadAdjustment, resolveProjectKey, summarizeThreads } from "./threadScoring.js";

const MS_PER_DAY = 86_400_000;

export class ThreadEnricher {
  constructor(
    private readonly config: ThreadKeeperConfig,
    private readonly client: ThreadKeeperClient,
    private readonly cache: ThreadCache,
  ) {}

  async enrichWithThreads(projects: Project[], now: Date = new Date()): Promise<void> {
    const staleMaxDays = this.config.staleMaxDays ?? 14;

    let allThreads: RawThread[] | null = null;
    try {
      allThreads = await this.client.fetchAllThreads();
    } catch (error) {
      console.warn(
        `ThreadKeeper 연결 실패, 캐시로 대체합니다: ${(error as Error).message}`,
      );
    }

    for (const project of projects) {
      const projectKey = resolveProjectKey(project, this.config.projectKeyOverrides);
      let continuity: ContinuitySummary;

      if (allThreads) {
        const summary = summarizeThreads(projectKey, allThreads);
        const { adjustment, signals } = computeThreadAdjustment(summary, now);
        await this.cache.save(projectKey, summary, now.toISOString());
        continuity = { coverage: "live", summary, threadAdjustment: adjustment, signals };
      } else {
        const cached = await this.cache.get(projectKey);
        if (cached) {
          const ageDays = (now.getTime() - new Date(cached.fetchedAt).getTime()) / MS_PER_DAY;
          if (ageDays <= staleMaxDays) {
            const { adjustment, signals } = computeThreadAdjustment(cached.summary, now);
            continuity = {
              coverage: "stale",
              summary: cached.summary,
              threadAdjustment: adjustment,
              signals,
              fetchedAt: cached.fetchedAt,
              ageDays: Math.floor(ageDays),
            };
          } else {
            continuity = { coverage: "unavailable", threadAdjustment: 0, signals: [] };
          }
        } else {
          continuity = { coverage: "unavailable", threadAdjustment: 0, signals: [] };
        }
      }

      project.continuity = continuity;
      project.readiness = Math.min(100, project.baseReadiness + continuity.threadAdjustment);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/ThreadEnricher.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/ThreadEnricher.ts src/core/ThreadEnricher.test.ts
git commit -m "feat: add ThreadEnricher with live/stale/unavailable coverage"
```

---

## Task 8: Wire baseReadiness + enrichment into Scanner

**Files:**
- Modify: `src/core/Scanner.ts` (the `analyzeProject` return ~line 287 and `scan()` ~line 60)
- Test: `src/core/Scanner.threads.test.ts`

- [ ] **Step 1: Set baseReadiness in analyzeProject**

In `src/core/Scanner.ts`, find the object returned by `analyzeProject` (around line 277-290). It currently has a line like:

```ts
      readiness: this.calculateReadiness(
        progress,
        activity,
        metadata,
        type,
      ),
```

Replace it so both fields are set from one computation:

```ts
      baseReadiness: this.calculateReadiness(progress, activity, metadata, type),
      readiness: this.calculateReadiness(progress, activity, metadata, type),
```

(Final `readiness` may be overwritten by enrichment; `baseReadiness` is permanent.)

- [ ] **Step 2: Add the enrichment hook to scan()**

In `src/core/Scanner.ts`, add imports at the top:

```ts
import { ThreadKeeperClient } from "./ThreadKeeperClient.js";
import { ThreadEnricher } from "./ThreadEnricher.js";
import { ThreadCache } from "../storage/ThreadCache.js";
```

Then modify `scan()` to enrich after building projects and **before** sorting/summarizing (so `avgReadiness` reflects final scores):

```ts
  async scan(): Promise<ScanResult> {
    const candidates = await this.scanProjectDirs();
    const projects = await Promise.all(
      candidates.map((candidate) => this.analyzeProject(candidate)),
    );

    await this.enrichProjects(projects);

    const sortedProjects = this.sortProjects(projects);
    const summary = this.buildSummary(sortedProjects);

    return {
      projects: sortedProjects,
      scannedAt: new Date(),
      summary,
    };
  }

  private async enrichProjects(projects: Project[]): Promise<void> {
    const tkConfig = this.config.threadKeeper;
    if (!tkConfig?.enabled) return;

    const client = new ThreadKeeperClient(
      tkConfig.baseUrl ?? "http://localhost:8080",
      tkConfig.timeoutMs ?? 2000,
    );
    const enricher = new ThreadEnricher(tkConfig, client, new ThreadCache());
    await enricher.enrichWithThreads(projects);
  }
```

Ensure `Project` is imported in `Scanner.ts` (it is used in the new method signature). If `Project` is not already imported, add it to the existing `ProjectModel.js` import.

- [ ] **Step 3: Write the integration test**

Create `src/core/Scanner.threads.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ThreadEnricher } from "./ThreadEnricher.js";
import type { Project, RawThread } from "./ProjectModel.js";
import type { ThreadKeeperClient } from "./ThreadKeeperClient.js";
import type { ThreadCache } from "../storage/ThreadCache.js";
import { vi } from "vitest";

function project(): Project {
  return {
    id: "pt", name: "pt", path: "/abs/pt", type: "node",
    progress: { percentage: 50, source: "readme", confidence: "medium", signals: [], lastUpdated: new Date() },
    activity: { lastCommitDate: null, commitsInLastWeek: 0, isActive: false, daysSinceLastCommit: 10 },
    metadata: { description: "", stack: [], hasReadme: true, hasClaude: false, hasGit: true },
    readiness: 70, baseReadiness: 70, scannedAt: new Date(),
  };
}

describe("Scanner thread enrichment contract", () => {
  it("leaves baseReadiness untouched and only changes final readiness", async () => {
    const threads: RawThread[] = [
      { id: 1, projectKey: "pt", title: "t", status: "COMPLETED", priority: "HIGH" },
    ];
    const client = { fetchAllThreads: vi.fn().mockResolvedValue(threads) } as unknown as ThreadKeeperClient;
    const cache = { get: vi.fn(async () => null), save: vi.fn(async () => {}) } as unknown as ThreadCache;
    const enricher = new ThreadEnricher({ enabled: true }, client, cache);
    const p = project();
    await enricher.enrichWithThreads([p]);
    expect(p.baseReadiness).toBe(70);
    expect(p.readiness).toBeGreaterThanOrEqual(70);
  });
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/core/Scanner.threads.test.ts && npx tsc --noEmit`
Expected: tests PASS; `tsc` reports no errors (the Task 1 `baseReadiness` error is now resolved).

- [ ] **Step 5: Run the full suite to catch regressions**

Run: `npx vitest run`
Expected: all tests PASS. If existing Scanner/report tests construct `Project` objects without `baseReadiness`, add `baseReadiness` to those fixtures (mirror the `readiness` value).

- [ ] **Step 6: Commit**

```bash
git add src/core/Scanner.ts src/core/Scanner.threads.test.ts
git commit -m "feat: wire baseReadiness and ThreadKeeper enrichment into Scanner.scan"
```

---

## Task 9: Config defaults + CLI threadkeeper command

**Files:**
- Modify: `src/config/ConfigManager.ts` (DEFAULT_CONFIG ~line 8)
- Modify: `src/cli/index.ts` (add a `threadkeeper` command alongside existing commands)

- [ ] **Step 1: Add ThreadKeeper defaults to DEFAULT_CONFIG**

In `src/config/ConfigManager.ts`, add a `threadKeeper` block to `DEFAULT_CONFIG`:

```ts
const DEFAULT_CONFIG: Config = {
  projectDirs: [
    "~/portfolio/projects",
    "~/IdeaProjects",
    "~/JsProjects",
    "~/PythonProjects",
    "~/PycharmProjects",
  ],
  scanInterval: 24 * 60 * 60 * 1000, // 24시간
  excludePatterns: ["node_modules", ".git", ".next", "dist", "build"],
  threadKeeper: {
    enabled: false,
    baseUrl: "http://localhost:8080",
    timeoutMs: 2000,
    staleMaxDays: 14,
  },
};
```

- [ ] **Step 2: Add a CLI command to toggle ThreadKeeper**

In `src/cli/index.ts`, add a new command (place it near the other top-level `.command(...)` definitions). Reuse the existing `ConfigManager` import already present in the file:

```ts
program
  .command("threadkeeper")
  .description("ThreadKeeper 연동 설정")
  .option("--enable", "ThreadKeeper 연동 켜기")
  .option("--disable", "ThreadKeeper 연동 끄기")
  .option("--url <url>", "ThreadKeeper base URL (예: http://localhost:8080)")
  .option("--timeout <ms>", "요청 타임아웃 (ms)")
  .option("--stale-days <days>", "캐시 유효 최대 일수")
  .action(
    async (options: {
      enable?: boolean;
      disable?: boolean;
      url?: string;
      timeout?: string;
      staleDays?: string;
    }) => {
      const configManager = new ConfigManager();
      const config = await configManager.load();
      const tk = { ...(config.threadKeeper ?? {}) };

      if (options.enable) tk.enabled = true;
      if (options.disable) tk.enabled = false;
      if (options.url) tk.baseUrl = options.url;
      if (options.timeout) tk.timeoutMs = Number(options.timeout);
      if (options.staleDays) tk.staleMaxDays = Number(options.staleDays);

      config.threadKeeper = tk;
      await configManager.save(config);

      console.log(chalk.green("ThreadKeeper 설정이 저장되었습니다."));
      console.log(`  enabled: ${tk.enabled ?? false}`);
      console.log(`  baseUrl: ${tk.baseUrl ?? "http://localhost:8080"}`);
      console.log(`  timeoutMs: ${tk.timeoutMs ?? 2000}`);
      console.log(`  staleMaxDays: ${tk.staleMaxDays ?? 14}`);
    },
  );
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

Run:
```bash
npm run build
node dist/cli/index.js threadkeeper --enable --url http://localhost:8080
```
Expected: prints "ThreadKeeper 설정이 저장되었습니다." with `enabled: true`. Confirm `config.json` now contains a `threadKeeper` block. Then run `node dist/cli/index.js threadkeeper --disable` and confirm `enabled: false` to leave it off by default.

- [ ] **Step 5: Commit**

```bash
git add src/config/ConfigManager.ts src/cli/index.ts
git commit -m "feat: add threadkeeper config defaults and CLI command"
```

---

## Task 10: Markdown report — readiness breakdown + thread column

**Files:**
- Modify: `src/report/MarkdownReport.ts`
- Test: `src/report/MarkdownReport.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/report/MarkdownReport.test.ts` (follow the existing fixture style in that file; include `baseReadiness` and `continuity` on the project fixture):

```ts
import { describe, it, expect } from "vitest";
import { renderMarkdownReport } from "./MarkdownReport.js";
import type { Project, ScanResult } from "../core/ProjectModel.js";

function makeResult(continuity?: Project["continuity"]): ScanResult {
  const project: Project = {
    id: "pt", name: "pt", path: "/abs/pt", type: "node",
    priority: "HIGH",
    progress: { percentage: 50, source: "readme", confidence: "medium", signals: [], lastUpdated: new Date("2026-06-02") },
    activity: { lastCommitDate: null, commitsInLastWeek: 0, isActive: false, daysSinceLastCommit: 3 },
    metadata: { description: "", stack: [], hasReadme: true, hasClaude: false, hasGit: true },
    baseReadiness: 71,
    readiness: continuity ? Math.min(100, 71 + continuity.threadAdjustment) : 71,
    continuity,
    scannedAt: new Date("2026-06-02"),
  };
  return {
    projects: [project],
    scannedAt: new Date("2026-06-02"),
    summary: { total: 1, active: 0, avgProgress: 50, avgReadiness: project.readiness, byPriority: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 }, byType: { node: 1, python: 0, dart: 0, java: 0, kotlin: 0, go: 0, rust: 0, unknown: 0 } },
  };
}

describe("MarkdownReport thread enrichment", () => {
  it("shows base+delta and coverage when continuity is live", () => {
    const md = renderMarkdownReport(makeResult({
      coverage: "live",
      threadAdjustment: 11,
      signals: [],
      summary: { projectKey: "pt", total: 7, active: 3, completed: 4, activeThreads: [], mostRecentActivityAt: null, representative: { title: "ship API", status: "ACTIVE", priority: "HIGH", currentNextAction: "write tests", lastActivityAt: null } },
    }), { includeLowPriority: true });
    expect(md).toContain("82% (71+11, live)");
    expect(md).toContain("활성 3 / 전체 7");
  });

  it("renders plain readiness when continuity is absent", () => {
    const md = renderMarkdownReport(makeResult(undefined), { includeLowPriority: true });
    expect(md).toContain("71%");
    expect(md).not.toContain("(71+");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/report/MarkdownReport.test.ts`
Expected: FAIL — readiness cell does not yet include the breakdown.

- [ ] **Step 3: Implement the rendering helpers**

In `src/report/MarkdownReport.ts`, import `ContinuitySummary`:

```ts
import { ContinuitySummary, Project, Progress, ScanResult } from "../core/ProjectModel.js";
```

Add these helpers near the other `format*` functions:

```ts
function formatCoverageBadge(coverage: ContinuitySummary["coverage"], ageDays?: number): string {
  if (coverage === "live") return "live";
  if (coverage === "stale") return `stale (${ageDays ?? "?"}d)`;
  return "offline";
}

function formatReadinessCell(project: Project): string {
  const c = project.continuity;
  if (!c || c.coverage === "unavailable") {
    return `${project.readiness}%`;
  }
  return `${project.readiness}% (${project.baseReadiness}+${c.threadAdjustment}, ${formatCoverageBadge(c.coverage, c.ageDays)})`;
}

function formatThreadCell(project: Project): string {
  const c = project.continuity;
  if (!c || !c.summary || c.summary.total === 0) return "-";
  const s = c.summary;
  const rep = s.representative
    ? `${escapeTableCell(s.representative.title)}${s.representative.currentNextAction ? ` → ${escapeTableCell(s.representative.currentNextAction)}` : ""}`
    : "-";
  return `활성 ${s.active} / 전체 ${s.total}<br>${rep}`;
}
```

In `renderProjectTable`, replace the readiness cell and add a Threads column. Change the row mapping:

```ts
  const rows = projects.map((project) =>
    [
      project.priority ?? "LOW",
      escapeTableCell(project.name),
      project.type,
      formatProgress(project.progress.percentage),
      formatProgressDetails(project.progress),
      formatReadinessCell(project),
      formatThreadCell(project),
      formatActivity(project.activity.daysSinceLastCommit),
      escapeTableCell(project.issues?.join(", ") || "-"),
    ].join(" | "),
  );

  return [
    "| Priority | Project | Type | Progress | Details | Readiness | Threads | Last activity | Issues |",
    "| --- | --- | --- | ---: | --- | ---: | --- | --- | --- |",
    ...rows.map((row) => `| ${row} |`),
  ].join("\n");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/report/MarkdownReport.test.ts`
Expected: PASS. If pre-existing tests in this file assert the old header/columns, update those expectations to include the new `Threads` column.

- [ ] **Step 5: Commit**

```bash
git add src/report/MarkdownReport.ts src/report/MarkdownReport.test.ts
git commit -m "feat: render readiness breakdown and thread column in markdown report"
```

---

## Task 11: JSON report — continuity passthrough test

**Files:**
- Test: `src/report/JsonReport.test.ts`
- (No production code change: `renderJsonReport` serializes the whole `Project`, so `continuity` is already included.)

- [ ] **Step 1: Add the test**

Add to `src/report/JsonReport.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderJsonReport } from "./JsonReport.js";
import type { Project, ScanResult } from "../core/ProjectModel.js";

describe("JsonReport continuity passthrough", () => {
  it("includes the continuity object in serialized output", () => {
    const project: Project = {
      id: "pt", name: "pt", path: "/abs/pt", type: "node", priority: "HIGH",
      progress: { percentage: 50, source: "readme", confidence: "medium", signals: [], lastUpdated: new Date("2026-06-02") },
      activity: { lastCommitDate: null, commitsInLastWeek: 0, isActive: false, daysSinceLastCommit: 3 },
      metadata: { description: "", stack: [], hasReadme: true, hasClaude: false, hasGit: true },
      baseReadiness: 71, readiness: 82,
      continuity: { coverage: "live", threadAdjustment: 11, signals: ["thread: 완료 4/7 (+3)"], summary: { projectKey: "pt", total: 7, active: 3, completed: 4, activeThreads: [], mostRecentActivityAt: null } },
      scannedAt: new Date("2026-06-02"),
    };
    const result: ScanResult = {
      projects: [project], scannedAt: new Date("2026-06-02"),
      summary: { total: 1, active: 0, avgProgress: 50, avgReadiness: 82, byPriority: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 }, byType: { node: 1, python: 0, dart: 0, java: 0, kotlin: 0, go: 0, rust: 0, unknown: 0 } },
    };
    const json = JSON.parse(renderJsonReport(result, { includeLowPriority: true }));
    expect(json.projects[0].continuity.coverage).toBe("live");
    expect(json.projects[0].continuity.threadAdjustment).toBe(11);
    expect(json.projects[0].baseReadiness).toBe(71);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/report/JsonReport.test.ts`
Expected: PASS (no production change needed — confirms the passthrough contract).

- [ ] **Step 3: Commit**

```bash
git add src/report/JsonReport.test.ts
git commit -m "test: assert JSON report includes continuity passthrough"
```

---

## Task 12: HTML report — readiness breakdown + thread cell

**Files:**
- Modify: `src/report/HtmlReport.ts`
- Test: `src/report/HtmlReport.test.ts`

- [ ] **Step 1: Inspect the current HTML row structure**

Open `src/report/HtmlReport.ts` and locate where each project row's readiness is rendered (search for `readiness`). Note the exact escaping helper used (e.g. `escapeHtml`) and the table header definition.

- [ ] **Step 2: Write the failing test**

Add to `src/report/HtmlReport.test.ts` (reuse the file's existing fixture pattern; set `baseReadiness` and `continuity`):

```ts
import { describe, it, expect } from "vitest";
import { renderHtmlReport } from "./HtmlReport.js";
import type { Project, ScanResult } from "../core/ProjectModel.js";

function result(): ScanResult {
  const project: Project = {
    id: "pt", name: "pt", path: "/abs/pt", type: "node", priority: "HIGH",
    progress: { percentage: 50, source: "readme", confidence: "medium", signals: [], lastUpdated: new Date("2026-06-02") },
    activity: { lastCommitDate: null, commitsInLastWeek: 0, isActive: false, daysSinceLastCommit: 3 },
    metadata: { description: "", stack: [], hasReadme: true, hasClaude: false, hasGit: true },
    baseReadiness: 71, readiness: 82,
    continuity: { coverage: "live", threadAdjustment: 11, signals: [], summary: { projectKey: "pt", total: 7, active: 3, completed: 4, activeThreads: [], mostRecentActivityAt: null, representative: { title: "ship API", status: "ACTIVE", priority: "HIGH", currentNextAction: "write tests", lastActivityAt: null } } },
    scannedAt: new Date("2026-06-02"),
  };
  return {
    projects: [project], scannedAt: new Date("2026-06-02"),
    summary: { total: 1, active: 0, avgProgress: 50, avgReadiness: 82, byPriority: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 }, byType: { node: 1, python: 0, dart: 0, java: 0, kotlin: 0, go: 0, rust: 0, unknown: 0 } },
  };
}

describe("HtmlReport thread enrichment", () => {
  it("shows the readiness breakdown and thread counts", () => {
    const html = renderHtmlReport(result(), { includeLowPriority: true });
    expect(html).toContain("82");
    expect(html).toContain("71+11");
    expect(html).toContain("활성 3 / 전체 7");
  });
});
```

(If `renderHtmlReport`'s options param differs, match the real signature observed in Step 1.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/report/HtmlReport.test.ts`
Expected: FAIL — breakdown text not present.

- [ ] **Step 4: Implement**

In `src/report/HtmlReport.ts`, add a Threads `<th>` to the table header and, in the per-project row builder, render:
- the readiness cell as `${readiness} <span class="tk-badge">(${baseReadiness}+${threadAdjustment}, ${coverageBadge})</span>` when `continuity` exists and is not `unavailable`, otherwise just `${readiness}`;
- a Threads cell as `활성 ${summary.active} / 전체 ${summary.total}` plus the representative title (escaped with the file's existing escape helper), or `-` when there is no summary.

Use the same `coverageBadge` mapping as Markdown: `live` → `live`, `stale` → `stale (Nd)`, `unavailable` → `offline`. Keep the HTML escaping consistent with the rest of the file.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/report/HtmlReport.test.ts`
Expected: PASS. Update any pre-existing HTML header assertions to include the new column.

- [ ] **Step 6: Commit**

```bash
git add src/report/HtmlReport.ts src/report/HtmlReport.test.ts
git commit -m "feat: render readiness breakdown and thread cell in html report"
```

---

## Task 13: Console report — breakdown cell + `--threads` detail view

**Files:**
- Modify: `src/cli/index.ts` (the `report` command, ~line 576-660)

- [ ] **Step 1: Add the `--threads` option and a readiness-cell helper**

In `src/cli/index.ts`, add the option to the `report` command:

```ts
  .option("--threads", "프로젝트별 활성 thread 상세 표시 (ThreadKeeper)")
```

Add `threads?: boolean` to the action's options type.

Add a module-level helper (near the other `format*` helpers in this file):

```ts
function formatReadinessCellConsole(project: import("../core/ProjectModel.js").Project): string {
  const c = project.continuity;
  if (!c || c.coverage === "unavailable") return `${project.readiness}%`;
  const badge = c.coverage === "live" ? "live" : `stale ${c.ageDays ?? "?"}d`;
  return `${project.readiness}% (${project.baseReadiness}+${c.threadAdjustment}, ${badge})`;
}
```

- [ ] **Step 2: Use the helper in the table row**

In the `report` action's `projects.forEach((project) => { table.push([ ... ]) })` block, replace the readiness entry (currently `${project.readiness}%` or similar) with `formatReadinessCellConsole(project)`.

- [ ] **Step 3: Add the detail view after the table is printed**

After the existing `console.log(table.toString())` (or equivalent) in the `report` action, add:

```ts
      if (options.threads) {
        console.log();
        console.log(chalk.cyan("ThreadKeeper 스레드 상세"));
        for (const project of projects) {
          const c = project.continuity;
          if (!c || !c.summary || c.summary.total === 0) continue;
          const badge =
            c.coverage === "live" ? "live" : c.coverage === "stale" ? `stale ${c.ageDays ?? "?"}d` : "offline";
          console.log(
            chalk.bold(`\n${project.name}`) +
              chalk.gray(` [${badge}] 활성 ${c.summary.active} / 전체 ${c.summary.total}`),
          );
          if (c.summary.activeThreads.length === 0) {
            console.log(chalk.gray("  활성 thread 없음"));
          }
          for (const t of c.summary.activeThreads) {
            const next = t.currentNextAction ? ` → ${t.currentNextAction}` : "";
            console.log(`  - [${t.priority}] ${t.title}${next}`);
          }
        }
      }
```

- [ ] **Step 4: Typecheck + build + smoke test**

Run:
```bash
npx tsc --noEmit && npm run build
node dist/cli/index.js report --threads
```
Expected: report prints; if ThreadKeeper is disabled, the readiness column shows plain `%` and the detail section prints nothing (no crash). With `threadkeeper --enable` and the API running, the readiness cells show `(base+delta, live)` and the detail section lists active threads.

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: console report readiness breakdown and --threads detail view"
```

---

## Task 14: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `npx vitest run`
Expected: all tests PASS.

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no type errors; lint clean (fix any new lint findings in the files you touched).

- [ ] **Step 3: End-to-end smoke test against a live ThreadKeeper (if available)**

If ThreadKeeper is running locally:
```bash
npm run build
node dist/cli/index.js threadkeeper --enable
node dist/cli/index.js report --refresh --threads
node dist/cli/index.js export -f json -o /tmp/pt-report.json   # confirm continuity present
node dist/cli/index.js threadkeeper --disable                  # restore default off
```
Expected: readiness cells show breakdown when live; stopping ThreadKeeper and re-running `report --refresh` shows `stale (Nd)` (using cache) or `offline`, and base scores are unchanged.

- [ ] **Step 4: Final commit (if any fixes were made)**

```bash
git add -A
git commit -m "chore: verification fixes for ThreadKeeper integration"
```

---

## Self-Review Notes

- **Spec coverage:** §3 modules → Tasks 1,5,6,7,8 (+threadScoring split out for testability). §5 scoring → Tasks 3,4. §6 fallback/coverage → Task 7. §7 project_key matching → Task 2 + Task 7. §8 display (compact + `--threads`) → Tasks 10–13. §9 config & CLI → Task 9. §10 testing → tests in every task + Task 14.
- **Spec deviation (documented):** The spec assumed `GET /api/v1/threads?projectKey=` filtering; the real endpoint returns all threads unfiltered, so the client fetches all and the enricher groups client-side. This is functionally equivalent and noted in Key Facts.
- **Type consistency:** `fetchAllThreads`, `summarizeThreads`, `computeThreadAdjustment`, `resolveProjectKey`, `enrichWithThreads`, `ContinuitySummary`, `ThreadSummary`, `RawThread`, `baseReadiness`, `continuity` are used identically across tasks.
- **Status semantics:** "active" = `ACTIVE`; "completed" = `COMPLETED`; `PAUSED`/`BLOCKED` count toward `total` only.
