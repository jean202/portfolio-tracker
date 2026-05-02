import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScanResult } from "../core/ProjectModel.js";
import { ScanStore } from "./ScanStore.js";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "portfolio-tracker-"));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("ScanStore", () => {
  it("saves and loads scan results with Date values revived", async () => {
    const store = new ScanStore(path.join(tempRoot, "data", "scan.json"));
    const now = new Date("2026-04-30T09:00:00.000Z");
    const result: ScanResult = {
      scannedAt: now,
      projects: [
        {
          id: "task-app",
          name: "task-app",
          path: path.join(tempRoot, "task-app"),
          type: "node",
          progress: {
            percentage: 50,
            source: "readme",
            confidence: "medium",
            signals: ["README.md: checklist"],
            lastUpdated: now,
          },
          priority: "HIGH",
          activity: {
            lastCommitDate: now,
            lastCommitMessage: "test",
            commitsInLastWeek: 1,
            isActive: true,
            daysSinceLastCommit: 0,
          },
          metadata: {
            description: "Task App",
            stack: ["node"],
            hasReadme: true,
            hasClaude: false,
            hasGit: true,
          },
          scannedAt: now,
        },
      ],
      summary: {
        total: 1,
        active: 1,
        avgProgress: 50,
        byPriority: {
          CRITICAL: 0,
          HIGH: 1,
          MEDIUM: 0,
          LOW: 0,
        },
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

    await store.save(result);
    const loaded = await store.load();

    expect(loaded?.scannedAt).toBeInstanceOf(Date);
    expect(loaded?.projects[0].progress.lastUpdated).toBeInstanceOf(Date);
    expect(loaded?.projects[0].activity.lastCommitDate).toBeInstanceOf(Date);
    expect(loaded?.summary.total).toBe(1);
  });
});
