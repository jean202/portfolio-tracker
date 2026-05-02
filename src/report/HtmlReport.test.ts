import { describe, expect, it } from "vitest";
import { ScanResult } from "../core/ProjectModel.js";
import { renderHtmlReport } from "./HtmlReport.js";

const scannedAt = new Date("2026-04-30T09:00:00.000Z");

const result: ScanResult = {
  scannedAt,
  projects: [
    {
      id: "active",
      name: "active-project",
      path: "/tmp/active-project",
      type: "node",
      progress: {
        percentage: 75,
        source: "readme",
        confidence: "high",
        signals: ["explicit progress"],
        lastUpdated: scannedAt,
      },
      priority: "HIGH",
      activity: {
        lastCommitDate: scannedAt,
        commitsInLastWeek: 1,
        isActive: true,
        daysSinceLastCommit: 0,
      },
      metadata: {
        description: "Active project",
        stack: ["node"],
        hasReadme: true,
        hasClaude: false,
        hasGit: true,
      },
      nextActions: ["Ship <HTML> export"],
      issues: [],
      scannedAt,
    },
    {
      id: "archived",
      name: "archived-project",
      path: "/tmp/archived-project",
      type: "unknown",
      progress: {
        percentage: null,
        source: "unknown",
        confidence: "low",
        signals: ["No reliable progress signal found"],
        lastUpdated: scannedAt,
      },
      priority: "LOW",
      activity: {
        lastCommitDate: null,
        commitsInLastWeek: 0,
        isActive: false,
        daysSinceLastCommit: Number.MAX_SAFE_INTEGER,
      },
      metadata: {
        description: "Archived project",
        stack: [],
        hasReadme: true,
        hasClaude: false,
        hasGit: false,
      },
      issues: ["Git 저장소 없음"],
      scannedAt,
    },
  ],
  summary: {
    total: 2,
    active: 1,
    avgProgress: 38,
    byPriority: {
      CRITICAL: 0,
      HIGH: 1,
      MEDIUM: 0,
      LOW: 1,
    },
    byType: {
      node: 1,
      python: 0,
      dart: 0,
      java: 0,
      kotlin: 0,
      go: 0,
      rust: 0,
      unknown: 1,
    },
  },
};

describe("renderHtmlReport", () => {
  it("renders an HTML dashboard and excludes LOW projects by default", () => {
    const html = renderHtmlReport(result);

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("active-project");
    expect(html).toContain("Ship &lt;HTML&gt; export");
    expect(html).not.toContain("archived-project");
  });

  it("can include LOW projects", () => {
    const html = renderHtmlReport(result, { includeLowPriority: true });

    expect(html).toContain("archived-project");
  });
});
