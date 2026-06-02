import { ContinuitySummary, Project, ScanResult } from "../core/ProjectModel.js";

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
  const focusProjects = actionable.slice(0, 3);

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f7f8fa">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Portfolio Tracker">
  <title>Portfolio Project Report</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --text: #18202a;
      --muted: #667085;
      --line: #d8dee8;
      --soft-line: #edf1f6;
      --critical: #c2410c;
      --high: #b45309;
      --medium: #2563eb;
      --low: #64748b;
      --active: #0f766e;
      --focus: #111827;
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

    .focus-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }

    .focus-card,
    .project-card,
    .action-block {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }

    .focus-card {
      padding: 16px;
    }

    .focus-card h3,
    .project-card h3,
    .action-block h3 {
      margin: 0;
      font-size: 15px;
    }

    .focus-card p {
      margin: 8px 0 0;
      color: var(--muted);
    }

    .focus-action {
      margin-top: 12px;
      color: var(--focus);
      font-weight: 700;
    }

    .table-wrap {
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
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
      padding: 14px 16px;
    }

    .action-block ul {
      margin: 8px 0 0;
      padding-left: 18px;
    }

    .project-cards {
      display: none;
    }

    .project-card {
      padding: 14px 16px;
    }

    .project-card-head {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    .project-card-meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--soft-line);
      color: var(--muted);
      font-size: 12px;
    }

    .project-card-meta strong {
      display: block;
      color: var(--text);
      font-size: 13px;
    }

    @media (max-width: 760px) {
      main {
        width: auto;
        margin: 24px 12px;
        padding-top: 20px;
      }

      header {
        display: block;
      }

      h1 {
        font-size: 24px;
      }

      .summary {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .focus-grid {
        grid-template-columns: 1fr;
      }

      .table-wrap {
        display: none;
      }

      .project-cards {
        display: grid;
        gap: 12px;
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

    ${focusProjects.length > 0 ? renderTodayFocus(focusProjects) : ""}

    <section>
      <h2>Projects</h2>
      ${renderProjectCards(projects)}
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

  return `<div class="table-wrap"><table>
  <thead>
    <tr>
      <th>Priority</th>
      <th>Project</th>
      <th>Type</th>
      <th>Progress</th>
      <th>Confidence</th>
      <th>Readiness</th>
      <th>Threads</th>
      <th>Last activity</th>
      <th>Issues</th>
    </tr>
  </thead>
  <tbody>
    ${projects.map(renderProjectRow).join("\n    ")}
  </tbody>
</table></div>`;
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
  <td>${readinessHtml(project)}</td>
  <td>${threadCellHtml(project)}</td>
  <td>${escapeHtml(formatActivity(project.activity.daysSinceLastCommit))}</td>
  <td>${escapeHtml(project.issues?.join(", ") || "-")}</td>
</tr>`;
}

function coverageBadge(
  coverage: ContinuitySummary["coverage"],
  ageDays?: number,
): string {
  if (coverage === "live") return "live";
  if (coverage === "stale") return `stale (${ageDays ?? "?"}d)`;
  return "offline";
}

function readinessHtml(project: Project): string {
  const c = project.continuity;
  if (!c || c.coverage === "unavailable") {
    return `${project.readiness}%`;
  }
  return `${project.readiness}% <span class="muted" style="font-size: 11px;">(${project.baseReadiness}+${c.threadAdjustment}, ${coverageBadge(c.coverage, c.ageDays)})</span>`;
}

function threadCellHtml(project: Project): string {
  const c = project.continuity;
  if (!c || !c.summary || c.summary.total === 0) return "-";
  const s = c.summary;
  const rep = s.representative
    ? `<div class="muted" style="font-size: 11px; margin-top: 2px;">${escapeHtml(s.representative.title)}${s.representative.currentNextAction ? ` → ${escapeHtml(s.representative.currentNextAction)}` : ""}</div>`
    : "";
  return `활성 ${s.active} / 전체 ${s.total}${rep}`;
}

function renderProjectCards(projects: Project[]): string {
  if (projects.length === 0) {
    return "";
  }

  return `<div class="project-cards">
    ${projects.map(renderProjectCard).join("\n    ")}
  </div>`;
}

function renderProjectCard(project: Project): string {
  const signalText = project.progress.signals[0]
    ? `<div class="muted">${escapeHtml(project.progress.signals[0])}</div>`
    : "";

  return `<article class="project-card">
  <div class="project-card-head">
    <div>
      <h3>${escapeHtml(project.name)}</h3>
      <div class="path">${escapeHtml(project.path)}</div>
    </div>
    ${renderPriority(project.priority ?? "LOW")}
  </div>
  <div class="progress"><div>${formatProgress(project.progress.percentage)}</div><div class="bar"><span style="width: ${progressBarWidth(project.progress.percentage)}%"></span></div></div>
  ${signalText}
  <div class="project-card-meta">
    <div><span>Type</span><strong>${escapeHtml(project.type)}</strong></div>
    <div><span>Readiness</span><strong>${project.readiness}%</strong></div>
    <div><span>Activity</span><strong>${escapeHtml(formatActivity(project.activity.daysSinceLastCommit))}</strong></div>
    <div><span>Issues</span><strong>${escapeHtml(project.issues?.join(", ") || "-")}</strong></div>
  </div>
</article>`;
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

function renderTodayFocus(projects: Project[]): string {
  return `<section>
  <h2>Today Focus</h2>
  <div class="focus-grid">
    ${projects.map(renderFocusCard).join("\n    ")}
  </div>
</section>`;
}

function renderFocusCard(project: Project): string {
  const firstAction = project.nextActions?.[0] ?? "Review the project status.";

  return `<article class="focus-card">
  ${renderPriority(project.priority ?? "LOW")}
  <h3>${escapeHtml(project.name)}</h3>
  <p>${formatProgress(project.progress.percentage)} complete · readiness ${project.readiness}%</p>
  <div class="focus-action">${escapeHtml(firstAction)}</div>
</article>`;
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
