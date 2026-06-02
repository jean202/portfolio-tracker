import type { RawThread, ThreadSummary, ThreadSummaryItem } from "./ProjectModel.js";

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
