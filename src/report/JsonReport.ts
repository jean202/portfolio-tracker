import { ScanResult } from "../core/ProjectModel.js";

export interface JsonReportOptions {
  includeLowPriority?: boolean;
}

export function renderJsonReport(
  result: ScanResult,
  options: JsonReportOptions = {},
): string {
  const projects = options.includeLowPriority
    ? result.projects
    : result.projects.filter((project) => project.priority !== "LOW");

  return `${JSON.stringify({ ...result, projects }, null, 2)}\n`;
}
