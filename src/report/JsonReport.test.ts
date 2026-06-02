import { describe, expect, it } from "vitest";
import { Project, ScanResult } from "../core/ProjectModel.js";
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

describe("renderJsonReport continuity passthrough", () => {
  it("includes the continuity object and baseReadiness in serialized output", () => {
    const project: Project = {
      id: "pt",
      name: "pt",
      path: "/abs/pt",
      type: "node",
      priority: "HIGH",
      progress: {
        percentage: 50,
        source: "readme",
        confidence: "medium",
        signals: [],
        lastUpdated: new Date("2026-06-02"),
      },
      activity: {
        lastCommitDate: null,
        commitsInLastWeek: 0,
        isActive: false,
        daysSinceLastCommit: 3,
      },
      metadata: {
        description: "",
        stack: [],
        hasReadme: true,
        hasClaude: false,
        hasGit: true,
      },
      baseReadiness: 71,
      readiness: 82,
      continuity: {
        coverage: "live",
        threadAdjustment: 11,
        signals: ["thread: 완료 4/7 (+3)"],
        summary: {
          projectKey: "pt",
          total: 7,
          active: 3,
          completed: 4,
          activeThreads: [],
          mostRecentActivityAt: null,
        },
      },
      scannedAt: new Date("2026-06-02"),
    };
    const enriched: ScanResult = {
      projects: [project],
      scannedAt: new Date("2026-06-02"),
      summary: {
        total: 1,
        active: 0,
        avgProgress: 50,
        avgReadiness: 82,
        byPriority: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 },
        byType: { node: 1, python: 0, dart: 0, java: 0, kotlin: 0, go: 0, rust: 0, unknown: 0 },
      },
    };
    const json = JSON.parse(
      renderJsonReport(enriched, { includeLowPriority: true }),
    );
    expect(json.projects[0].continuity.coverage).toBe("live");
    expect(json.projects[0].continuity.threadAdjustment).toBe(11);
    expect(json.projects[0].baseReadiness).toBe(71);
  });
});
