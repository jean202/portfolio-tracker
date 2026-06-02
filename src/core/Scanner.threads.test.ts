import { describe, it, expect, vi } from "vitest";
import { ThreadEnricher } from "./ThreadEnricher.js";
import type { Project, RawThread } from "./ProjectModel.js";
import type { ThreadKeeperClient } from "./ThreadKeeperClient.js";
import type { ThreadCache } from "../storage/ThreadCache.js";

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
