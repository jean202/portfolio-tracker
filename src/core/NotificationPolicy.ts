import type { ScanDiff, ProjectChange } from "./TrendAnalyzer.js";

export interface NotificationPolicyOptions {
  progressChangeThreshold?: number | null;
}

export const DEFAULT_PROGRESS_CHANGE_THRESHOLD = 5;

export function resolveProgressChangeThreshold(
  options: NotificationPolicyOptions = {},
): number {
  const threshold = options.progressChangeThreshold;
  if (threshold === undefined || threshold === null) {
    return DEFAULT_PROGRESS_CHANGE_THRESHOLD;
  }

  if (!Number.isFinite(threshold) || threshold < 0) {
    return DEFAULT_PROGRESS_CHANGE_THRESHOLD;
  }

  return threshold;
}

export function hasMeaningfulNotificationChange(
  diff: ScanDiff,
  options: NotificationPolicyOptions = {},
): boolean {
  return diff.projects.some((project) =>
    isMeaningfulProjectChange(project, options),
  );
}

export function countMeaningfulProgressChanges(
  diff: ScanDiff,
  options: NotificationPolicyOptions = {},
): number {
  return diff.projects.filter((project) =>
    isMeaningfulProgressChange(project, options),
  ).length;
}

export function isMeaningfulProjectChange(
  project: ProjectChange,
  options: NotificationPolicyOptions = {},
): boolean {
  return (
    project.status === "new" ||
    project.status === "removed" ||
    isMeaningfulProgressChange(project, options)
  );
}

export function isMeaningfulProgressChange(
  project: ProjectChange,
  options: NotificationPolicyOptions = {},
): boolean {
  const threshold = resolveProgressChangeThreshold(options);
  return (
    project.progressChange !== null &&
    project.progressChange !== 0 &&
    Math.abs(project.progressChange) >= threshold
  );
}
