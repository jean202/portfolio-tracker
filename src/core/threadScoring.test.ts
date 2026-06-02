import { describe, it, expect } from "vitest";
import { resolveProjectKey, summarizeThreads } from "./threadScoring.js";
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
