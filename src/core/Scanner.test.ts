import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Scanner } from "./Scanner.js";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "portfolio-tracker-"));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("Scanner", () => {
  it("finds project directories from known metadata files", async () => {
    await fs.mkdir(path.join(tempRoot, "node-app"));
    await fs.writeFile(
      path.join(tempRoot, "node-app", "package.json"),
      '{"name":"node-app"}',
    );

    await fs.mkdir(path.join(tempRoot, "notes"));
    await fs.writeFile(
      path.join(tempRoot, "notes", "memo.txt"),
      "not a project",
    );

    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const projects = await scanner.scanProjectDirs();

    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      name: "node-app",
      packageJsonType: "node",
      hasReadme: false,
    });
  });

  it("builds a report with checkbox progress and summary counts", async () => {
    await fs.mkdir(path.join(tempRoot, "task-app"));
    await fs.writeFile(
      path.join(tempRoot, "task-app", "README.md"),
      ["# Task App", "", "- [x] scanner", "- [ ] report"].join("\n"),
    );

    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const result = await scanner.scan();

    expect(result.summary.total).toBe(1);
    expect(result.summary.avgProgress).toBe(50);
    expect(result.projects[0].progress).toMatchObject({
      percentage: 50,
      source: "readme",
      confidence: "medium",
      breakdown: { completed: 1, total: 2 },
    });
  });

  it("uses planning documents as progress sources", async () => {
    await fs.mkdir(path.join(tempRoot, "planned-app"));
    await fs.writeFile(
      path.join(tempRoot, "planned-app", "README.md"),
      "# Planned App",
    );
    await fs.writeFile(
      path.join(tempRoot, "planned-app", "PROJECT_PLAN.md"),
      ["# Plan", "", "진행률: 65%", "", "다음: polish"].join("\n"),
    );

    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const result = await scanner.scan();

    expect(result.projects[0].progress).toMatchObject({
      percentage: 65,
      source: "project_plan",
      confidence: "high",
    });
    expect(result.projects[0].progress.signals[0]).toContain("PROJECT_PLAN.md");
  });

  it("marks progress as unknown when no reliable signal exists", async () => {
    await fs.mkdir(path.join(tempRoot, "unclear-app"));
    await fs.writeFile(
      path.join(tempRoot, "unclear-app", "README.md"),
      "# Unclear App",
    );

    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const result = await scanner.scan();

    expect(result.summary.avgProgress).toBeNull();
    expect(result.projects[0].progress).toMatchObject({
      percentage: null,
      source: "unknown",
      confidence: "low",
    });
    expect(result.projects[0].issues).toContain("진행률 판단 불가");
  });
});
