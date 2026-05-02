import { Project, Progress, ScanResult } from "../core/ProjectModel.js";

export interface MarkdownReportOptions {
  includeLowPriority?: boolean;
}

export function renderMarkdownReport(
  result: ScanResult,
  options: MarkdownReportOptions = {},
): string {
  const projects = options.includeLowPriority
    ? result.projects
    : result.projects.filter((project) => project.priority !== "LOW");

  return [
    "# Portfolio Project Report",
    "",
    `Generated: ${formatDateTime(result.scannedAt)}`,
    "",
    "## Summary",
    "",
    `- Total projects: ${result.summary.total}`,
    `- Active projects: ${result.summary.active}`,
    `- Average progress: ${formatProgress(result.summary.avgProgress)}`,
    `- Portfolio readiness: ${result.summary.avgReadiness}%`,
    `- Priority: CRITICAL ${result.summary.byPriority.CRITICAL}, HIGH ${result.summary.byPriority.HIGH}, MEDIUM ${result.summary.byPriority.MEDIUM}, LOW ${result.summary.byPriority.LOW}`,
    "",
    "## Projects",
    "",
    renderProjectTable(projects),
    "",
    renderNextActions(projects),
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function renderProjectTable(projects: Project[]): string {
  if (projects.length === 0) {
    return "_No projects to display._";
  }

  const rows = projects.map((project) =>
    [
      project.priority ?? "LOW",
      escapeTableCell(project.name),
      project.type,
      formatProgress(project.progress.percentage),
      formatProgressDetails(project.progress),
      `${project.readiness}%`,
      formatActivity(project.activity.daysSinceLastCommit),
      escapeTableCell(project.issues?.join(", ") || "-"),
    ].join(" | "),
  );

  return [
    "| Priority | Project | Type | Progress | Details | Readiness | Last activity | Issues |",
    "| --- | --- | --- | ---: | --- | ---: | --- | --- |",
    ...rows.map((row) => `| ${row} |`),
  ].join("\n");
}

function renderNextActions(projects: Project[]): string {
  const actionable = projects.filter(
    (project) => project.nextActions && project.nextActions.length > 0,
  );

  if (actionable.length === 0) {
    return "";
  }

  const lines = ["## Next Actions", ""];
  actionable.forEach((project) => {
    lines.push(`### ${project.name}`, "");
    project.nextActions?.slice(0, 5).forEach((action) => {
      lines.push(`- ${action}`);
    });
    lines.push("");
  });

  return lines.join("\n").trimEnd();
}

function formatActivity(daysSinceLastCommit: number): string {
  if (daysSinceLastCommit === Number.MAX_SAFE_INTEGER) return "No commits";
  if (daysSinceLastCommit === 0) return "Today";
  return `${daysSinceLastCommit} days ago`;
}

function formatProgress(percentage: number | null): string {
  if (percentage === null) return "Unknown";
  return `${percentage}%`;
}

function formatProgressDetails(progress: Progress): string {
  const parts: string[] = [];

  parts.push(progress.confidence);

  if (progress.signals.length > 0) {
    const signals = progress.signals.slice(0, 2).join("; ");
    parts.push(`(${signals})`);
  }

  return parts.join(" ");
}

function formatDateTime(value: Date): string {
  return value.toISOString();
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}
