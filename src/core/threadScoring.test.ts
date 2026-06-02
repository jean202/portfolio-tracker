import { describe, it, expect } from "vitest";
import { resolveProjectKey, summarizeThreads } from "./threadScoring.js";
import type { RawThread } from "./ProjectModel.js";
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

  it("sums the three signals and clamps to at most 20", () => {
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
    // signal1: 5/5 active have next action -> round(6)=6
    // signal2: recency(<=3d)=5 + active(>=3)=3 -> min(8,8)=8
    // signal3: completed 5/10 -> round(0.5*6)=3
    // total = 17, and never exceeds the 20 cap
    expect(adjustment).toBe(17);
    expect(adjustment).toBeLessThanOrEqual(20);
  });
});
