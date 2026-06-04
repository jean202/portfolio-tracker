# 활동 히트맵 — PT 데이터 계약 Implementation Plan (1/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** portfolio-tracker가 프로젝트별 최근 91일 일자별 커밋 수(`Activity.recentCommitDays`)를 `scan-result.json`에 내보내게 한다 — pt-mobile 히트맵이 소비할 데이터.

**Architecture:** 순수 헬퍼 `buildCommitHistogram(commitDates, now, days)`가 커밋 날짜 배열을 `YYYY-MM-DD → count` 맵으로 집계(윈도우 컷오프·로컬일 포맷). Scanner는 기존 활동 계산을 건드리지 않고, 별도 윈도우 git.log 호출 결과를 이 헬퍼에 넘겨 필드를 채운다.

**Tech Stack:** TypeScript, simple-git, Vitest.

> **레포:** `/Users/jean325/portfolio/portfolio-tracker/` (이하 경로 상대). 이 레포는 git remote 없음(로컬 main). 테스트: `npx vitest run <file>`. 타입체크: `npx tsc --noEmit`.

## 기존 코드 (참고)

- `src/core/ProjectModel.ts` — `interface Activity { lastCommitDate: Date|null; lastCommitMessage?: string; commitsInLastWeek: number; isActive: boolean; daysSinceLastCommit: number; }`.
- `src/core/Scanner.ts` — `private async detectActivity(candidate): Promise<Activity>` (376~415줄): non-git이면 빈 활동, 아니면 `simpleGit(path).log({maxCount:50})`로 latest/commitsInLastWeek/daysSinceLastCommit 계산, 실패 시 빈 활동. `async scan(): Promise<ScanResult>`가 이를 거쳐 projects를 만든다.
- `src/core/Scanner.test.ts` — 실제 temp git 레포 생성 패턴(`simpleGit(dir).init()/addConfig/add/commit`) 보유.

---

## File Structure

| 파일 | 책임 |
|------|------|
| `src/core/CommitHistogram.ts` | (신규) `buildCommitHistogram` 순수 헬퍼 |
| `src/core/CommitHistogram.test.ts` | 단위 테스트 |
| `src/core/ProjectModel.ts` | (수정) `Activity`에 `recentCommitDays?` 추가 |
| `src/core/Scanner.ts` | (수정) 윈도우 git.log → 헬퍼 → 필드 채움 |
| `src/core/Scanner.test.ts` | (수정) 통합 테스트 1개 추가 |

---

## Task 1: buildCommitHistogram (순수 헬퍼)

**Files:**
- Create: `src/core/CommitHistogram.ts`
- Test: `src/core/CommitHistogram.test.ts`

- [ ] **Step 1: Write the failing test**

`src/core/CommitHistogram.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildCommitHistogram } from "./CommitHistogram";

describe("buildCommitHistogram", () => {
  const now = new Date(2026, 5, 4, 12, 0, 0); // 2026-06-04 local noon

  it("groups multiple commits on the same local day", () => {
    const h = buildCommitHistogram(
      [new Date(2026, 5, 4, 9), new Date(2026, 5, 4, 18)],
      now,
    );
    expect(h["2026-06-04"]).toBe(2);
  });

  it("keeps different days separate", () => {
    const h = buildCommitHistogram(
      [new Date(2026, 5, 4), new Date(2026, 5, 3)],
      now,
    );
    expect(h["2026-06-04"]).toBe(1);
    expect(h["2026-06-03"]).toBe(1);
  });

  it("excludes commits older than the window", () => {
    const old = new Date(now.getTime() - 92 * 24 * 60 * 60 * 1000);
    const h = buildCommitHistogram([old], now, 91);
    expect(Object.keys(h)).toHaveLength(0);
  });

  it("excludes future commits", () => {
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const h = buildCommitHistogram([future], now);
    expect(Object.keys(h)).toHaveLength(0);
  });

  it("skips invalid dates and returns {} for empty input", () => {
    expect(buildCommitHistogram([], now)).toEqual({});
    expect(buildCommitHistogram([new Date("nope")], now)).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/CommitHistogram.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/CommitHistogram.ts`**

```ts
/**
 * Per-day commit counts over a trailing window, for the activity heatmap.
 * Keys are local calendar days "YYYY-MM-DD"; days with no commits are omitted.
 */
export function buildCommitHistogram(
  commitDates: Date[],
  now: Date,
  days = 91,
): Record<string, number> {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();
  const out: Record<string, number> = {};
  for (const d of commitDates) {
    const t = d.getTime();
    if (Number.isNaN(t)) continue;
    if (t < cutoff || t > nowMs) continue; // inside window, not future
    const key = localDayKey(d);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/CommitHistogram.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/CommitHistogram.ts src/core/CommitHistogram.test.ts && git commit -m "feat: buildCommitHistogram helper for activity heatmap

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Activity 타입에 recentCommitDays 추가

**Files:**
- Modify: `src/core/ProjectModel.ts`

- [ ] **Step 1: Add the optional field**

In `src/core/ProjectModel.ts`, change the `Activity` interface to add `recentCommitDays`:
```ts
export interface Activity {
  lastCommitDate: Date | null;
  lastCommitMessage?: string;
  commitsInLastWeek: number;
  isActive: boolean;
  daysSinceLastCommit: number;
  /** Local-day "YYYY-MM-DD" → commit count over the last ~91 days. Omitted on non-git/failure. */
  recentCommitDays?: Record<string, number>;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (field is optional; nothing else needs changes yet).

- [ ] **Step 3: Commit**

```bash
git add src/core/ProjectModel.ts && git commit -m "feat: add Activity.recentCommitDays field

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Scanner가 recentCommitDays를 채우게 연결

**Files:**
- Modify: `src/core/Scanner.ts`
- Test: `src/core/Scanner.test.ts`

- [ ] **Step 1: Write the failing integration test**

Append to `src/core/Scanner.test.ts` (inside the existing top-level `describe`, after the last test; the file already imports `simpleGit`, `fs`, `path`, `Scanner`, and sets up `tempRoot`):
```ts
  it("emits recentCommitDays for a git project with a recent commit", async () => {
    const projectDir = path.join(tempRoot, "heatmap-project");
    await fs.mkdir(projectDir);
    const git = simpleGit(projectDir);
    await git.init();
    await git.addConfig("user.email", "test@test.com");
    await git.addConfig("user.name", "Test User");
    await fs.writeFile(path.join(projectDir, "README.md"), "# Heatmap");
    await git.add(".");
    await git.commit("initial commit");

    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const result = await scanner.scan();
    const project = result.projects.find((p) => p.path === projectDir);
    expect(project).toBeDefined();

    const days = project!.activity.recentCommitDays;
    expect(days).toBeDefined();
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(days![key]).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/Scanner.test.ts`
Expected: FAIL — `recentCommitDays` is undefined (Scanner doesn't populate it yet).

- [ ] **Step 3: Wire the windowed log in `detectActivity`**

In `src/core/Scanner.ts`:

a) Add the import near the top (with the other `./` imports):
```ts
import { buildCommitHistogram } from "./CommitHistogram";
```

b) In `detectActivity`, inside the existing `try` block (the one that builds the success `return`), compute the histogram from a separate windowed query and include it in the returned object. Replace the success-path return:
```ts
      const daysSinceLastCommit = lastCommitDate
        ? Math.floor(
            (Date.now() - lastCommitDate.getTime()) / (24 * 60 * 60 * 1000),
          )
        : Number.MAX_SAFE_INTEGER;

      let recentCommitDays: Record<string, number> | undefined;
      try {
        const windowLog = await git.log({
          "--since": "91 days ago",
          maxCount: 2000,
        });
        recentCommitDays = buildCommitHistogram(
          windowLog.all.map((c) => new Date(c.date)),
          new Date(),
        );
      } catch {
        recentCommitDays = undefined;
      }

      return {
        lastCommitDate,
        lastCommitMessage: latest?.message,
        commitsInLastWeek,
        isActive: daysSinceLastCommit <= 14,
        daysSinceLastCommit,
        recentCommitDays,
      };
```
(Leave the non-git branch and the outer `catch` branch unchanged — they return Activity without `recentCommitDays`, which is fine since it's optional.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/Scanner.test.ts`
Expected: PASS (existing tests + the new one).

- [ ] **Step 5: Typecheck + full test sweep**

Run: `npx tsc --noEmit` then `npx vitest run`
Expected: no type errors; whole suite green.

- [ ] **Step 6: Commit**

```bash
git add src/core/Scanner.ts src/core/Scanner.test.ts && git commit -m "feat: populate Activity.recentCommitDays from windowed git log

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review 메모

- **스펙 §2/§3(PT) 커버리지:** `recentCommitDays` 필드(Task 2) / `buildCommitHistogram` 윈도우·로컬일·집계(Task 1) / Scanner 윈도우 쿼리 연결(Task 3) 모두 태스크 존재.
- **타입 일관성:** `buildCommitHistogram(commitDates: Date[], now: Date, days=91): Record<string,number>`를 Task 1 정의 후 Task 3에서 동일 시그니처로 호출. `Activity.recentCommitDays?: Record<string,number>` Task 2 정의 후 Task 3에서 채움.
- **격리:** 기존 `git.log({maxCount:50})` 기반 활동 계산은 변경하지 않음. 윈도우 쿼리는 별도 try/catch로 감싸 실패해도 나머지 활동 필드에 영향 없음.
- **다음:** 앱 플랜(2/2)이 이 `recentCommitDays`를 파싱해 히트맵으로 렌더.
