import { Project, ScanResult } from "../core/ProjectModel.js";

export interface HtmlReportOptions {
  includeLowPriority?: boolean;
}

export function renderHtmlReport(
  result: ScanResult,
  options: HtmlReportOptions = {},
): string {
  const projects = options.includeLowPriority
    ? result.projects
    : result.projects.filter((project) => project.priority !== "LOW");
  const actionable = projects.filter(
    (project) => project.nextActions && project.nextActions.length > 0,
  );

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Portfolio Project Report</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --text: #18202a;
      --muted: #667085;
      --line: #d8dee8;
      --critical: #c2410c;
      --high: #b45309;
      --medium: #2563eb;
      --low: #64748b;
      --active: #0f766e;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.5;
    }

    main {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 32px 0 48px;
    }

    header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 24px;
    }

    h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 750;
    }

    h2 {
      margin: 32px 0 12px;
      font-size: 18px;
    }

    .muted {
      color: var(--muted);
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }

    .metric {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px 16px;
    }

    .metric span {
      display: block;
      color: var(--muted);
      font-size: 12px;
    }

    .metric strong {
      display: block;
      margin-top: 4px;
      font-size: 24px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }

    th,
    td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }

    th {
      background: #eef2f7;
      color: #344054;
      font-size: 12px;
      text-transform: uppercase;
    }

    tr:last-child td {
      border-bottom: 0;
    }

    .priority {
      display: inline-block;
      min-width: 78px;
      border-radius: 999px;
      padding: 2px 8px;
      color: #ffffff;
      font-size: 12px;
      font-weight: 700;
      text-align: center;
    }

    .priority-critical {
      background: var(--critical);
    }

    .priority-high {
      background: var(--high);
    }

    .priority-medium {
      background: var(--medium);
    }

    .priority-low {
      background: var(--low);
    }

    .progress {
      width: 120px;
    }

    .bar {
      height: 8px;
      overflow: hidden;
      background: #e5e7eb;
      border-radius: 999px;
    }

    .bar > span {
      display: block;
      height: 100%;
      background: var(--active);
    }

    .path {
      margin-top: 2px;
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .actions {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
    }

    .action-block {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px 16px;
    }

    .action-block h3 {
      margin: 0 0 8px;
      font-size: 15px;
    }

    .action-block ul {
      margin: 0;
      padding-left: 18px;
    }

    @media (max-width: 760px) {
      main {
        width: min(100vw - 20px, 1180px);
        padding-top: 20px;
      }

      header {
        display: block;
      }

      .summary {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      table {
        display: block;
        overflow-x: auto;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Portfolio Project Report</h1>
        <div class="muted">Generated ${escapeHtml(formatDateTime(result.scannedAt))}</div>
      </div>
      <div class="muted">${projects.length} displayed / ${result.summary.total} scanned</div>
    </header>

    <section class="summary" aria-label="Summary">
      ${renderMetric("Total", result.summary.total)}
      ${renderMetric("Active", result.summary.active)}
      ${renderMetric("Average Progress", formatProgress(result.summary.avgProgress))}
      ${renderMetric("Portfolio Readiness", `${result.summary.avgReadiness}%`)}
    </section>

    <section>
      <h2>Projects</h2>
      ${renderProjectTable(projects)}
    </section>

    ${actionable.length > 0 ? renderNextActions(actionable) : ""}
  </main>
</body>
</html>
`;
}

function renderMetric(label: string, value: string | number): string {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function renderProjectTable(projects: Project[]): string {
  if (projects.length === 0) {
    return `<p class="muted">No projects to display.</p>`;
  }

  return `<table>
  <thead>
    <tr>
      <th>Priority</th>
      <th>Project</th>
      <th>Type</th>
      <th>Progress</th>
      <th>Confidence</th>
      <th>Readiness</th>
      <th>Last activity</th>
      <th>Issues</th>
    </tr>
  </thead>
  <tbody>
    ${projects.map(renderProjectRow).join("\n    ")}
  </tbody>
</table>`;
}

function renderProjectRow(project: Project): string {
  const signalText = project.progress.signals[0]
    ? `<div class="muted" style="font-size: 11px; margin-top: 2px;">${escapeHtml(project.progress.signals[0])}</div>`
    : "";

  return `<tr>
  <td>${renderPriority(project.priority ?? "LOW")}</td>
  <td><strong>${escapeHtml(project.name)}</strong><div class="path">${escapeHtml(project.path)}</div></td>
  <td>${escapeHtml(project.type)}</td>
  <td class="progress"><div>${formatProgress(project.progress.percentage)}</div><div class="bar"><span style="width: ${progressBarWidth(project.progress.percentage)}%"></span></div></td>
  <td><div>${escapeHtml(project.progress.confidence)}</div>${signalText}</td>
  <td>${project.readiness}%</td>
  <td>${escapeHtml(formatActivity(project.activity.daysSinceLastCommit))}</td>
  <td>${escapeHtml(project.issues?.join(", ") || "-")}</td>
</tr>`;
}

function renderPriority(priority: string): string {
  return `<span class="priority priority-${priority.toLowerCase()}">${escapeHtml(priority)}</span>`;
}

function renderNextActions(projects: Project[]): string {
  return `<section>
  <h2>Next Actions</h2>
  <div class="actions">
    ${projects
      .map(
        (project) => `<div class="action-block">
      <h3>${escapeHtml(project.name)}</h3>
      <ul>
        ${project.nextActions
          ?.slice(0, 5)
          .map((action) => `<li>${escapeHtml(action)}</li>`)
          .join("\n        ")}
      </ul>
    </div>`,
      )
      .join("\n    ")}
  </div>
</section>`;
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

function progressBarWidth(percentage: number | null): number {
  return percentage ?? 0;
}

function formatDateTime(value: Date): string {
  return value.toISOString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
