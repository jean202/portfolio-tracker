import { describe, expect, it } from "vitest";
import { Project, ScanResult } from "../core/ProjectModel.js";
import { renderMarkdownReport } from "./MarkdownReport.js";

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
      nextActions: ["Ship export command"],
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

describe("renderMarkdownReport", () => {
  it("renders a markdown report and excludes LOW projects by default", () => {
    const markdown = renderMarkdownReport(result);

    expect(markdown).toContain("# Portfolio Project Report");
    expect(markdown).toContain("active-project");
    expect(markdown).toContain("Ship export command");
    expect(markdown).not.toContain("archived-project");
  });

  it("can include LOW projects", () => {
    const markdown = renderMarkdownReport(result, { includeLowPriority: true });

    expect(markdown).toContain("archived-project");
  });
});

function makeResult(continuity?: Project["continuity"]): ScanResult {
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
    readiness: continuity ? Math.min(100, 71 + continuity.threadAdjustment) : 71,
    continuity,
    scannedAt: new Date("2026-06-02"),
  };
  return {
    projects: [project],
    scannedAt: new Date("2026-06-02"),
    summary: {
      total: 1,
      active: 0,
      avgProgress: 50,
      avgReadiness: project.readiness,
      byPriority: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 },
      byType: { node: 1, python: 0, dart: 0, java: 0, kotlin: 0, go: 0, rust: 0, unknown: 0 },
    },
  };
}

describe("MarkdownReport thread enrichment", () => {
  it("shows base+delta and coverage when continuity is live", () => {
    const md = renderMarkdownReport(
      makeResult({
        coverage: "live",
        threadAdjustment: 11,
        signals: [],
        summary: {
          projectKey: "pt",
          total: 7,
          active: 3,
          completed: 4,
          activeThreads: [],
          mostRecentActivityAt: null,
          representative: {
            title: "ship API",
            status: "ACTIVE",
            priority: "HIGH",
            currentNextAction: "write tests",
            lastActivityAt: null,
          },
        },
      }),
      { includeLowPriority: true },
    );
    expect(md).toContain("82% (71+11, live)");
    expect(md).toContain("활성 3 / 전체 7");
  });

  it("renders plain readiness when continuity is absent", () => {
    const md = renderMarkdownReport(makeResult(undefined), { includeLowPriority: true });
    expect(md).toContain("71%");
    expect(md).not.toContain("(71+");
  });
});
