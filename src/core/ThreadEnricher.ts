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
