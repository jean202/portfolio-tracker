import { describe, expect, it } from "vitest";
import { ScanResult } from "../core/ProjectModel.js";
import { renderJsonReport } from "./JsonReport.js";

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

describe("renderJsonReport", () => {
  it("renders pretty JSON and excludes LOW projects by default", () => {
    const parsed = JSON.parse(renderJsonReport(result)) as ScanResult;

    expect(parsed.projects).toHaveLength(1);
    expect(parsed.projects[0].name).toBe("active-project");
    expect(renderJsonReport(result)).toContain("\n  ");
  });

  it("can include LOW projects", () => {
    const parsed = JSON.parse(
      renderJsonReport(result, { includeLowPriority: true }),
    ) as ScanResult;

    expect(parsed.projects).toHaveLength(2);
  });
});
