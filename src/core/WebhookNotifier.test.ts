import { describe, it, expect, vi, afterEach } from "vitest";
import { WebhookNotifier } from "./WebhookNotifier.js";
import type { ScanDiff } from "./TrendAnalyzer.js";
import type { Project, ScanResult } from "./ProjectModel.js";

function makeDiff(overrides: Partial<ScanDiff> = {}): ScanDiff {
  const emptySummary: ScanResult["summary"] = {
    total: 0,
    active: 0,
    avgProgress: null,
    avgReadiness: 0,
    byPriority: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    byType: {
      node: 0,
      python: 0,
      dart: 0,
      java: 0,
      kotlin: 0,
      go: 0,
      rust: 0,
      unknown: 0,
    },
  };
  return {
    fromDate: new Date("2026-01-01"),
    toDate: new Date("2026-01-02"),
    summary: {
      before: emptySummary,
      after: emptySummary,
      changes: { total: 0, active: 0, avgProgress: null, avgReadiness: 0 },
    },
    projects: [],
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-id",
    name: "project",
    path: "/tmp/project",
    type: "node",
    progress: {
      percentage: 50,
      source: "readme",
      confidence: "high",
      signals: [],
      lastUpdated: new Date("2026-01-01T00:00:00.000Z"),
    },
    priority: "MEDIUM",
    activity: {
      lastCommitDate: new Date("2026-01-01T00:00:00.000Z"),
      commitsInLastWeek: 1,
      isActive: true,
      daysSinceLastCommit: 0,
    },
    metadata: {
      description: "project",
      stack: ["Node.js"],
      hasReadme: true,
      hasClaude: false,
      hasGit: true,
    },
    readiness: 50,
    baseReadiness: 50,
    nextActions: [],
    issues: [],
    scannedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("WebhookNotifier.shouldNotify", () => {
  it("새 프로젝트가 있으면 true를 반환한다", () => {
    const diff = makeDiff({
      projects: [
        {
          name: "new-proj",
          before: null,
          after: makeProject({ name: "new-proj" }),
          status: "new",
          progressChange: null,
          readinessChange: 50,
          activityChange: 0,
        },
      ],
    });
    expect(WebhookNotifier.shouldNotify(diff)).toBe(true);
  });

  it("삭제된 프로젝트가 있으면 true를 반환한다", () => {
    const diff = makeDiff({
      projects: [
        {
          name: "gone-proj",
          before: makeProject({ name: "gone-proj" }),
          after: null,
          status: "removed",
          progressChange: null,
          readinessChange: -50,
          activityChange: 0,
        },
      ],
    });
    expect(WebhookNotifier.shouldNotify(diff)).toBe(true);
  });

  it("진행률 변화가 5%p 이상이면 true를 반환한다", () => {
    const diff = makeDiff({
      projects: [
        {
          name: "proj",
          before: makeProject({ name: "proj" }),
          after: makeProject({ name: "proj" }),
          status: "changed",
          progressChange: 5,
          readinessChange: 0,
          activityChange: 0,
        },
      ],
    });
    expect(WebhookNotifier.shouldNotify(diff)).toBe(true);
  });

  it("진행률 변화가 5%p 미만이고 추가/삭제 없으면 false를 반환한다", () => {
    const diff = makeDiff({
      projects: [
        {
          name: "proj",
          before: makeProject({ name: "proj" }),
          after: makeProject({ name: "proj" }),
          status: "changed",
          progressChange: 4,
          readinessChange: 0,
          activityChange: 0,
        },
      ],
    });
    expect(WebhookNotifier.shouldNotify(diff)).toBe(false);
  });

  it("custom threshold를 사용해 진행률 변화 알림을 판단한다", () => {
    const diff = makeDiff({
      projects: [
        {
          name: "proj",
          before: makeProject({ name: "proj" }),
          after: makeProject({ name: "proj" }),
          status: "changed",
          progressChange: 8,
          readinessChange: 0,
          activityChange: 0,
        },
      ],
    });

    expect(
      WebhookNotifier.shouldNotify(diff, { progressChangeThreshold: 10 }),
    ).toBe(false);
    expect(
      WebhookNotifier.shouldNotify(diff, { progressChangeThreshold: 8 }),
    ).toBe(true);
  });

  it("변경이 없으면 false를 반환한다", () => {
    const diff = makeDiff();
    expect(WebhookNotifier.shouldNotify(diff)).toBe(false);
  });
});

describe("WebhookNotifier.notify", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("올바른 URL과 payload로 fetch POST를 호출한다", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const notifier = new WebhookNotifier("https://example.com/hook");
    const payload = {
      scannedAt: "2026-01-01T00:00:00.000Z",
      summary: {
        total: 1,
        active: 1,
        avgProgress: 50 as number | null,
        avgReadiness: 60,
      },
      changes: {
        added: ["proj-a"],
        removed: [] as string[],
        changed: [] as never[],
      },
    };

    await notifier.notify(payload);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith("https://example.com/hook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  it("fetch 실패 시 오류를 throw한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );

    const notifier = new WebhookNotifier("https://example.com/hook");
    await expect(
      notifier.notify({
        scannedAt: "2026-01-01T00:00:00.000Z",
        summary: { total: 0, active: 0, avgProgress: null, avgReadiness: 0 },
        changes: { added: [], removed: [], changed: [] },
      }),
    ).rejects.toThrow("network error");
  });

  it("HTTP 오류 응답이면 오류를 throw한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      }),
    );

    const notifier = new WebhookNotifier("https://example.com/hook");
    await expect(
      notifier.notify({
        scannedAt: "2026-01-01T00:00:00.000Z",
        summary: { total: 0, active: 0, avgProgress: null, avgReadiness: 0 },
        changes: { added: [], removed: [], changed: [] },
      }),
    ).rejects.toThrow("Webhook failed: 503 Service Unavailable");
  });
});

describe("WebhookNotifier.buildPayload", () => {
  it("diff와 scan 결과로 올바른 payload를 생성한다", () => {
    const after: ScanResult = {
      projects: [],
      scannedAt: new Date("2026-01-02T00:00:00.000Z"),
      summary: {
        total: 3,
        active: 2,
        avgProgress: 60,
        avgReadiness: 70,
        byPriority: { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 0 },
        byType: {
          node: 2,
          python: 1,
          dart: 0,
          java: 0,
          kotlin: 0,
          go: 0,
          rust: 0,
          unknown: 0,
        },
      },
    };

    const diff = makeDiff({
      projects: [
        {
          name: "new-proj",
          before: null,
          after: makeProject({ name: "new-proj" }),
          status: "new",
          progressChange: null,
          readinessChange: 50,
          activityChange: 0,
        },
        {
          name: "gone-proj",
          before: makeProject({ name: "gone-proj" }),
          after: null,
          status: "removed",
          progressChange: null,
          readinessChange: -30,
          activityChange: 0,
        },
        {
          name: "big-change",
          before: makeProject({
            name: "big-change",
            progress: {
              ...makeProject().progress,
              percentage: 40,
            },
            readiness: 50,
          }),
          after: makeProject({
            name: "big-change",
            progress: {
              ...makeProject().progress,
              percentage: 80,
            },
            readiness: 80,
          }),
          status: "changed",
          progressChange: 40,
          readinessChange: 30,
          activityChange: 0,
        },
        {
          name: "small-change",
          before: makeProject({
            name: "small-change",
            progress: {
              ...makeProject().progress,
              percentage: 50,
            },
            readiness: 60,
          }),
          after: makeProject({
            name: "small-change",
            progress: {
              ...makeProject().progress,
              percentage: 53,
            },
            readiness: 62,
          }),
          status: "changed",
          progressChange: 3,
          readinessChange: 2,
          activityChange: 0,
        },
      ],
    });

    const payload = WebhookNotifier.buildPayload(diff, after);

    expect(payload.scannedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(payload.summary).toEqual({
      total: 3,
      active: 2,
      avgProgress: 60,
      avgReadiness: 70,
    });
    expect(payload.changes.added).toEqual(["new-proj"]);
    expect(payload.changes.removed).toEqual(["gone-proj"]);
    // big-change (40%p) is included; small-change (3%p) is below threshold
    expect(payload.changes.changed).toHaveLength(1);
    expect(payload.changes.changed[0]).toMatchObject({
      name: "big-change",
      progressBefore: 40,
      progressAfter: 80,
    });
  });

  it("custom threshold로 payload의 changed 목록을 필터링한다", () => {
    const after: ScanResult = {
      projects: [],
      scannedAt: new Date("2026-01-02T00:00:00.000Z"),
      summary: {
        total: 1,
        active: 1,
        avgProgress: 60,
        avgReadiness: 70,
        byPriority: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 },
        byType: {
          node: 1,
          python: 0,
          dart: 0,
          java: 0,
          kotlin: 0,
          go: 0,
          rust: 0,
          unknown: 0,
        },
      },
    };
    const diff = makeDiff({
      projects: [
        {
          name: "change",
          before: makeProject({
            name: "change",
            progress: {
              ...makeProject().progress,
              percentage: 50,
            },
          }),
          after: makeProject({
            name: "change",
            progress: {
              ...makeProject().progress,
              percentage: 58,
            },
          }),
          status: "changed",
          progressChange: 8,
          readinessChange: 0,
          activityChange: 0,
        },
      ],
    });

    const payload = WebhookNotifier.buildPayload(diff, after, {
      progressChangeThreshold: 10,
    });

    expect(payload.changes.changed).toEqual([]);
  });
});
