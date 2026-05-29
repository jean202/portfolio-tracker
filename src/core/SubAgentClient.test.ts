import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildScanNotification,
  shouldNotifySubAgent,
  SubAgentClient,
} from "./SubAgentClient.js";
import type { ScanDiff } from "./TrendAnalyzer.js";
import type { ScanResult } from "./ProjectModel.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SubAgentClient", () => {
  it("reads token file and posts a task", async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "sub-agent-client-"),
    );
    const tokenPath = path.join(tempDir, "token");
    await fs.writeFile(tokenPath, "secret\n");
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task: { id: "task-1", action: "notification.show", status: "queued" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task: {
            id: "task-1",
            action: "notification.show",
            status: "succeeded",
          },
        }),
      });
    vi.stubGlobal("fetch", mockFetch);

    const client = new SubAgentClient({
      baseUrl: "http://127.0.0.1:4877",
      tokenFile: tokenPath,
    });
    await client.notify("Title", "Message");

    expect(mockFetch).toHaveBeenCalledWith("http://127.0.0.1:4877/tasks", {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "notification.show",
        args: { title: "Title", message: "Message" },
      }),
    });
  });
});

describe("shouldNotifySubAgent", () => {
  it("requires enabled config", () => {
    expect(shouldNotifySubAgent(undefined, null)).toBe(false);
    expect(
      shouldNotifySubAgent({ enabled: false, notifyOnScan: true }, null),
    ).toBe(false);
  });

  it("notifies every scan when notifyOnScan is true", () => {
    expect(
      shouldNotifySubAgent({ enabled: true, notifyOnScan: true }, null),
    ).toBe(true);
  });

  it("notifies on meaningful diff when notifyOnChanges is true", () => {
    const diff = makeDiff({
      projects: [
        {
          name: "project-a",
          before: null,
          after: {} as never,
          status: "new",
          progressChange: null,
          readinessChange: 10,
          activityChange: 0,
        },
      ],
    });

    expect(
      shouldNotifySubAgent({ enabled: true, notifyOnChanges: true }, diff),
    ).toBe(true);
  });

  it("uses a custom progress threshold for change notifications", () => {
    const diff = makeDiff({
      projects: [
        {
          name: "project-a",
          before: {} as never,
          after: {} as never,
          status: "changed",
          progressChange: 8,
          readinessChange: 0,
          activityChange: 0,
        },
      ],
    });

    expect(
      shouldNotifySubAgent({ enabled: true, notifyOnChanges: true }, diff, {
        progressChangeThreshold: 10,
      }),
    ).toBe(false);
    expect(
      shouldNotifySubAgent({ enabled: true, notifyOnChanges: true }, diff, {
        progressChangeThreshold: 8,
      }),
    ).toBe(true);
  });
});

describe("buildScanNotification", () => {
  it("builds a concise scan summary", () => {
    const result = makeScanResult();
    const notification = buildScanNotification(result, null);

    expect(notification.title).toBe("Portfolio Tracker 스캔 완료");
    expect(notification.message).toContain("3개 프로젝트");
    expect(notification.message).toContain("준비도 70%");
  });

  it("does not include a top mover when every progress change is zero", () => {
    const result = makeScanResult();
    const notification = buildScanNotification(
      result,
      makeDiff({
        projects: [
          {
            name: "project-a",
            before: {} as never,
            after: {} as never,
            status: "unchanged",
            progressChange: 0,
            readinessChange: 0,
            activityChange: 0,
          },
        ],
      }),
    );

    expect(notification.message).toContain("큰 변화 없음");
    expect(notification.message).not.toContain("최대 변화");
    expect(notification.title).toBe("Portfolio Tracker 스캔 완료");
  });

  it("uses a custom threshold for the change count", () => {
    const result = makeScanResult();
    const diff = makeDiff({
      projects: [
        {
          name: "project-a",
          before: {} as never,
          after: {} as never,
          status: "changed",
          progressChange: 8,
          readinessChange: 0,
          activityChange: 0,
        },
      ],
    });

    expect(
      buildScanNotification(result, diff, {
        progressChangeThreshold: 10,
      }).message,
    ).toContain("큰 변화 없음");
    expect(
      buildScanNotification(result, diff, {
        progressChangeThreshold: 8,
      }).message,
    ).toContain("진행률 변화 1");
  });
});

function makeScanResult(): ScanResult {
  return {
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
}

function makeDiff(overrides: Partial<ScanDiff> = {}): ScanDiff {
  const summary = makeScanResult().summary;
  return {
    fromDate: new Date("2026-01-01T00:00:00.000Z"),
    toDate: new Date("2026-01-02T00:00:00.000Z"),
    summary: {
      before: summary,
      after: summary,
      changes: {
        total: 0,
        active: 0,
        avgProgress: null,
        avgReadiness: 0,
      },
    },
    projects: [],
    ...overrides,
  };
}
