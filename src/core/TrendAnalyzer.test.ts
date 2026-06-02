import { describe, expect, it } from "vitest";
import { Project, ScanResult } from "./ProjectModel.js";
import { TrendAnalyzer } from "./TrendAnalyzer.js";

function makeProject(overrides: Partial<Project> = {}): Project {
  const now = new Date();
  return {
    id: "proj",
    name: "proj",
    path: "/tmp/proj",
    type: "node",
    progress: {
      percentage: 50,
      source: "readme",
      confidence: "medium",
      signals: [],
      lastUpdated: now,
    },
    priority: "MEDIUM",
    activity: {
      lastCommitDate: now,
      commitsInLastWeek: 1,
      isActive: true,
      daysSinceLastCommit: 1,
    },
    metadata: {
      description: "",
      stack: [],
      hasReadme: true,
      hasClaude: false,
      hasGit: true,
    },
    readiness: 60,
    baseReadiness: 60,
    scannedAt: now,
    ...overrides,
  };
}

function makeScanResult(
  scannedAt: Date,
  projects: Project[],
  summaryOverrides: Partial<ScanResult["summary"]> = {},
): ScanResult {
  return {
    scannedAt,
    projects,
    summary: {
      total: projects.length,
      active: projects.filter((p) => p.activity.isActive).length,
      avgProgress: 50,
      avgReadiness: 60,
      byPriority: { CRITICAL: 0, HIGH: 0, MEDIUM: projects.length, LOW: 0 },
      byType: {
        node: projects.length,
        python: 0,
        dart: 0,
        java: 0,
        kotlin: 0,
        go: 0,
        rust: 0,
        unknown: 0,
      },
      ...summaryOverrides,
    },
  };
}

describe("TrendAnalyzer.diff", () => {
  it("detects new and removed projects", () => {
    const t1 = new Date("2026-04-29T12:00:00.000Z");
    const t2 = new Date("2026-05-02T12:00:00.000Z");

    const before = makeScanResult(t1, [
      makeProject({ name: "kept" }),
      makeProject({ name: "removed", id: "removed" }),
    ]);
    const after = makeScanResult(t2, [
      makeProject({ name: "kept" }),
      makeProject({ name: "new", id: "new" }),
    ]);

    const diff = TrendAnalyzer.diff(before, after);

    const newOnes = diff.projects.filter((p) => p.status === "new");
    const removed = diff.projects.filter((p) => p.status === "removed");

    expect(newOnes).toHaveLength(1);
    expect(newOnes[0].name).toBe("new");
    expect(removed).toHaveLength(1);
    expect(removed[0].name).toBe("removed");
  });

  it("calculates progress and readiness changes", () => {
    const t1 = new Date("2026-04-29T12:00:00.000Z");
    const t2 = new Date("2026-05-02T12:00:00.000Z");

    const before = makeScanResult(t1, [
      makeProject({
        name: "asset-radar",
        progress: {
          percentage: 65,
          source: "readme",
          confidence: "high",
          signals: [],
          lastUpdated: t1,
        },
        readiness: 87,
      }),
    ]);

    const after = makeScanResult(t2, [
      makeProject({
        name: "asset-radar",
        progress: {
          percentage: 83,
          source: "readme",
          confidence: "high",
          signals: [],
          lastUpdated: t2,
        },
        readiness: 97,
      }),
    ]);

    const diff = TrendAnalyzer.diff(before, after);
    const change = diff.projects.find((p) => p.name === "asset-radar");

    expect(change?.status).toBe("changed");
    expect(change?.progressChange).toBe(18);
    expect(change?.readinessChange).toBe(10);
  });

  it("marks unchanged projects", () => {
    const t1 = new Date("2026-04-29T12:00:00.000Z");
    const t2 = new Date("2026-05-02T12:00:00.000Z");

    const same = makeProject({
      name: "static",
      progress: {
        percentage: 50,
        source: "readme",
        confidence: "medium",
        signals: [],
        lastUpdated: t1,
      },
      readiness: 60,
      activity: {
        lastCommitDate: t1,
        commitsInLastWeek: 0,
        isActive: false,
        daysSinceLastCommit: 10,
      },
    });

    const before = makeScanResult(t1, [same]);
    const after = makeScanResult(t2, [
      {
        ...same,
        activity: { ...same.activity, daysSinceLastCommit: 10 },
      },
    ]);

    const diff = TrendAnalyzer.diff(before, after);
    const change = diff.projects.find((p) => p.name === "static");

    expect(change?.status).toBe("unchanged");
    expect(change?.progressChange).toBe(0);
    expect(change?.readinessChange).toBe(0);
  });

  it("handles null progress correctly", () => {
    const t1 = new Date("2026-04-29T12:00:00.000Z");
    const t2 = new Date("2026-05-02T12:00:00.000Z");

    const before = makeScanResult(t1, [
      makeProject({
        name: "unknown-progress",
        progress: {
          percentage: null,
          source: "unknown",
          confidence: "low",
          signals: [],
          lastUpdated: t1,
        },
      }),
    ]);

    const after = makeScanResult(t2, [
      makeProject({
        name: "unknown-progress",
        progress: {
          percentage: 40,
          source: "readme",
          confidence: "high",
          signals: [],
          lastUpdated: t2,
        },
      }),
    ]);

    const diff = TrendAnalyzer.diff(before, after);
    const change = diff.projects.find((p) => p.name === "unknown-progress");

    // null → 40: change should be 40
    expect(change?.progressChange).toBe(40);
  });

  it("calculates summary changes correctly", () => {
    const t1 = new Date("2026-04-29T12:00:00.000Z");
    const t2 = new Date("2026-05-02T12:00:00.000Z");

    const before = makeScanResult(t1, [makeProject()], {
      avgProgress: 50,
      avgReadiness: 55,
      active: 5,
      total: 10,
    });
    const after = makeScanResult(t2, [makeProject()], {
      avgProgress: 60,
      avgReadiness: 65,
      active: 7,
      total: 10,
    });

    const diff = TrendAnalyzer.diff(before, after);

    expect(diff.summary.changes.avgProgress).toBe(10);
    expect(diff.summary.changes.avgReadiness).toBe(10);
    expect(diff.summary.changes.active).toBe(2);
    expect(diff.summary.changes.total).toBe(0);
  });
});

describe("TrendAnalyzer.buildTrend", () => {
  it("returns trend data points in given order", () => {
    const t1 = new Date("2026-04-25T12:00:00.000Z");
    const t2 = new Date("2026-04-29T12:00:00.000Z");
    const t3 = new Date("2026-05-02T12:00:00.000Z");

    const results = [
      makeScanResult(t1, [makeProject()], {
        avgProgress: 30,
        avgReadiness: 50,
      }),
      makeScanResult(t2, [makeProject()], {
        avgProgress: 50,
        avgReadiness: 60,
      }),
      makeScanResult(t3, [makeProject()], {
        avgProgress: 70,
        avgReadiness: 75,
      }),
    ];

    const trend = TrendAnalyzer.buildTrend(results);

    expect(trend).toHaveLength(3);
    expect(trend[0].avgProgress).toBe(30);
    expect(trend[2].avgProgress).toBe(70);
  });
});

describe("TrendAnalyzer.buildProjectTrend", () => {
  it("filters by project name and returns its trend", () => {
    const t1 = new Date("2026-04-25T12:00:00.000Z");
    const t2 = new Date("2026-04-29T12:00:00.000Z");

    const results = [
      makeScanResult(t1, [
        makeProject({
          name: "asset-radar",
          progress: {
            percentage: 50,
            source: "readme",
            confidence: "high",
            signals: [],
            lastUpdated: t1,
          },
          readiness: 80,
        }),
        makeProject({ name: "other" }),
      ]),
      makeScanResult(t2, [
        makeProject({
          name: "asset-radar",
          progress: {
            percentage: 65,
            source: "readme",
            confidence: "high",
            signals: [],
            lastUpdated: t2,
          },
          readiness: 87,
        }),
      ]),
    ];

    const trend = TrendAnalyzer.buildProjectTrend(results, "asset-radar");

    expect(trend).toHaveLength(2);
    expect(trend[0].percentage).toBe(50);
    expect(trend[1].percentage).toBe(65);
  });

  it("is case-insensitive when matching project names", () => {
    const results = [
      makeScanResult(new Date(), [makeProject({ name: "Cleanera" })]),
    ];

    const trend = TrendAnalyzer.buildProjectTrend(results, "cleanera");
    expect(trend).toHaveLength(1);
  });

  it("returns empty array when project not found", () => {
    const results = [makeScanResult(new Date(), [makeProject({ name: "a" })])];
    const trend = TrendAnalyzer.buildProjectTrend(results, "nonexistent");
    expect(trend).toEqual([]);
  });
});

describe("TrendAnalyzer.topMovers", () => {
  it("returns projects sorted by absolute progress change", () => {
    const t1 = new Date("2026-04-29T12:00:00.000Z");
    const t2 = new Date("2026-05-02T12:00:00.000Z");

    const before = makeScanResult(t1, [
      makeProject({
        name: "small",
        progress: {
          percentage: 50,
          source: "readme",
          confidence: "medium",
          signals: [],
          lastUpdated: t1,
        },
      }),
      makeProject({
        name: "big",
        progress: {
          percentage: 30,
          source: "readme",
          confidence: "medium",
          signals: [],
          lastUpdated: t1,
        },
      }),
    ]);

    const after = makeScanResult(t2, [
      makeProject({
        name: "small",
        progress: {
          percentage: 53,
          source: "readme",
          confidence: "medium",
          signals: [],
          lastUpdated: t2,
        },
      }),
      makeProject({
        name: "big",
        progress: {
          percentage: 70,
          source: "readme",
          confidence: "medium",
          signals: [],
          lastUpdated: t2,
        },
      }),
    ]);

    const diff = TrendAnalyzer.diff(before, after);
    const movers = TrendAnalyzer.topMovers(diff, 5);

    expect(movers[0].name).toBe("big"); // +40
    expect(movers[1].name).toBe("small"); // +3
  });
});
