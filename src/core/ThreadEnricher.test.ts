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
