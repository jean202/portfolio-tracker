import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScanResult } from "../core/ProjectModel.js";
import { HistoryStore } from "./HistoryStore.js";

let tempDir: string;

function buildScanResult(scannedAt: Date, avgProgress = 50): ScanResult {
  return {
    scannedAt,
    projects: [
      {
        id: "test-app",
        name: "test-app",
        path: "/tmp/test-app",
        type: "node",
        progress: {
          percentage: avgProgress,
          source: "readme",
          confidence: "medium",
          signals: ["test"],
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
          description: "Test",
          stack: ["node"],
          hasReadme: true,
          hasClaude: false,
          hasGit: true,
        },
        readiness: 70,
        baseReadiness: 70,
        scannedAt,
      },
    ],
    summary: {
      total: 1,
      active: 1,
      avgProgress,
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
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "history-store-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("HistoryStore", () => {
  it("saves and lists scans in chronological order (newest first)", async () => {
    const store = new HistoryStore(tempDir);
    const t1 = new Date("2026-04-25T12:00:00.000Z");
    const t2 = new Date("2026-04-29T12:00:00.000Z");
    const t3 = new Date("2026-05-02T12:00:00.000Z");

    await store.save(buildScanResult(t1));
    await store.save(buildScanResult(t2));
    await store.save(buildScanResult(t3));

    const list = await store.list();
    expect(list).toHaveLength(3);
    expect(list[0].timestamp).toBe(t3.getTime());
    expect(list[1].timestamp).toBe(t2.getTime());
    expect(list[2].timestamp).toBe(t1.getTime());
  });

  it("loads recent N entries with revived dates", async () => {
    const store = new HistoryStore(tempDir);
    const t1 = new Date("2026-04-25T12:00:00.000Z");
    const t2 = new Date("2026-04-29T12:00:00.000Z");

    await store.save(buildScanResult(t1, 30));
    await store.save(buildScanResult(t2, 50));

    const recent = await store.loadRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].scannedAt).toBeInstanceOf(Date);
    expect(recent[0].summary.avgProgress).toBe(50); // 최신
    expect(recent[1].summary.avgProgress).toBe(30);
  });

  it("loads latest and previous correctly", async () => {
    const store = new HistoryStore(tempDir);
    const t1 = new Date("2026-04-25T12:00:00.000Z");
    const t2 = new Date("2026-04-29T12:00:00.000Z");
    const t3 = new Date("2026-05-02T12:00:00.000Z");

    await store.save(buildScanResult(t1, 30));
    await store.save(buildScanResult(t2, 50));
    await store.save(buildScanResult(t3, 70));

    const latest = await store.loadLatest();
    const previous = await store.loadPrevious();

    expect(latest?.summary.avgProgress).toBe(70);
    expect(previous?.summary.avgProgress).toBe(50);
  });

  it("returns null when no history exists", async () => {
    const store = new HistoryStore(tempDir);
    expect(await store.loadLatest()).toBeNull();
    expect(await store.loadPrevious()).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it("loads scans within date range (oldest first)", async () => {
    const store = new HistoryStore(tempDir);
    const t1 = new Date("2026-04-20T12:00:00.000Z");
    const t2 = new Date("2026-04-25T12:00:00.000Z");
    const t3 = new Date("2026-04-29T12:00:00.000Z");
    const t4 = new Date("2026-05-02T12:00:00.000Z");

    await store.save(buildScanResult(t1, 10));
    await store.save(buildScanResult(t2, 30));
    await store.save(buildScanResult(t3, 50));
    await store.save(buildScanResult(t4, 70));

    const range = await store.loadInRange(
      new Date("2026-04-25T00:00:00.000Z"),
      new Date("2026-04-30T00:00:00.000Z"),
    );

    expect(range).toHaveLength(2);
    expect(range[0].summary.avgProgress).toBe(30); // oldest first
    expect(range[1].summary.avgProgress).toBe(50);
  });

  it("prunes old entries beyond keepCount", async () => {
    const store = new HistoryStore(tempDir);
    const dates = [
      "2026-04-20T12:00:00.000Z",
      "2026-04-25T12:00:00.000Z",
      "2026-04-29T12:00:00.000Z",
      "2026-05-02T12:00:00.000Z",
      "2026-05-05T12:00:00.000Z",
    ].map((d) => new Date(d));

    for (const d of dates) {
      await store.save(buildScanResult(d));
    }

    expect(await store.list()).toHaveLength(5);

    const deleted = await store.prune(3);
    expect(deleted).toBe(2);
    expect(await store.list()).toHaveLength(3);

    // 가장 최근 3개가 남아야 함
    const remaining = await store.list();
    expect(remaining[0].timestamp).toBe(dates[4].getTime());
    expect(remaining[1].timestamp).toBe(dates[3].getTime());
    expect(remaining[2].timestamp).toBe(dates[2].getTime());
  });

  it("ignores non-json and malformed files", async () => {
    const store = new HistoryStore(tempDir);
    await store.save(buildScanResult(new Date("2026-05-01T12:00:00.000Z")));

    // 잘못된 파일 추가
    await fs.writeFile(path.join(tempDir, "junk.txt"), "not json");
    await fs.writeFile(path.join(tempDir, "abc.json"), "not a number");

    const list = await store.list();
    expect(list).toHaveLength(1);
  });
});
