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
