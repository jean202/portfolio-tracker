import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import simpleGit from "simple-git";
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

describe("Scanner.isProjectChanged", () => {
  it("non-git 프로젝트에서 최근 파일이 있으면 변경됨으로 판단한다", async () => {
    const projectDir = path.join(tempRoot, "no-git-new");
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, "README.md"), "# Hello");

    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const candidate = {
      name: "no-git-new",
      path: projectDir,
      hasReadme: true,
      hasClaude: false,
      hasGit: false,
    };
    // lastScannedAt은 파일 생성 이전 시각
    const lastScannedAt = new Date(Date.now() - 10_000);

    const changed = await scanner.isProjectChanged(candidate, lastScannedAt);
    expect(changed).toBe(true);
  });

  it("non-git 프로젝트에서 미래 시각 기준이면 변경 없음으로 판단한다", async () => {
    const projectDir = path.join(tempRoot, "no-git-old");
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, "README.md"), "# Stable");

    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const candidate = {
      name: "no-git-old",
      path: projectDir,
      hasReadme: true,
      hasClaude: false,
      hasGit: false,
    };
    // lastScannedAt이 미래 → 모든 파일이 오래된 것으로 간주
    const lastScannedAt = new Date(Date.now() + 60_000);

    const changed = await scanner.isProjectChanged(candidate, lastScannedAt);
    expect(changed).toBe(false);
  });

  it("git 프로젝트에서 최근 커밋이 있으면 변경됨으로 판단한다", async () => {
    const projectDir = path.join(tempRoot, "git-project");
    await fs.mkdir(projectDir);

    // real git repo with one commit
    const git = simpleGit(projectDir);
    await git.init();
    await git.addConfig("user.email", "test@test.com");
    await git.addConfig("user.name", "Test User");
    await fs.writeFile(path.join(projectDir, "README.md"), "# Git Project");
    await git.add(".");
    await git.commit("initial commit");

    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const candidate = {
      name: "git-project",
      path: projectDir,
      hasReadme: true,
      hasClaude: false,
      hasGit: true,
    };
    // lastScannedAt은 커밋 이전 시각
    const lastScannedAt = new Date(Date.now() - 10_000);

    const changed = await scanner.isProjectChanged(candidate, lastScannedAt);
    expect(changed).toBe(true);
  });

  it("git 프로젝트에서 커밋이 lastScannedAt보다 오래됐으면 변경 없음으로 판단한다", async () => {
    const projectDir = path.join(tempRoot, "git-old-project");
    await fs.mkdir(projectDir);

    const git = simpleGit(projectDir);
    await git.init();
    await git.addConfig("user.email", "test@test.com");
    await git.addConfig("user.name", "Test User");
    await fs.writeFile(path.join(projectDir, "README.md"), "# Old Git Project");
    await git.add(".");
    await git.commit("initial commit");

    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const candidate = {
      name: "git-old-project",
      path: projectDir,
      hasReadme: true,
      hasClaude: false,
      hasGit: true,
    };
    // lastScannedAt이 미래 → 커밋이 오래된 것으로 간주
    const lastScannedAt = new Date(Date.now() + 60_000);

    const changed = await scanner.isProjectChanged(candidate, lastScannedAt);
    expect(changed).toBe(false);
  });
});

describe("Scanner.scanIncremental", () => {
  it("변경 없는 프로젝트는 캐시 데이터를 그대로 반환한다", async () => {
    const projectDir = path.join(tempRoot, "stable");
    await fs.mkdir(projectDir);
    await fs.writeFile(
      path.join(projectDir, "README.md"),
      "# Stable\n\n진행률: 50%",
    );

    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const firstResult = await scanner.scan();

    // lastScannedAt을 미래로 설정 → 변경 없음
    const fakeLastResult = { ...firstResult, scannedAt: new Date(Date.now() + 60_000) };
    const { result, rescanned, reused } = await scanner.scanIncremental(fakeLastResult);

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe("stable");
    expect(rescanned).toBe(0);
    expect(reused).toBe(1);
  });

  it("변경된 프로젝트는 재분석해서 최신 진행률을 반영한다", async () => {
    const projectDir = path.join(tempRoot, "changing");
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, "README.md"), "# Changing");

    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const firstResult = await scanner.scan();
    expect(firstResult.projects[0].progress.percentage).toBeNull();

    // 파일 수정 (진행률 추가)
    await fs.writeFile(
      path.join(projectDir, "README.md"),
      "# Changing\n\n진행률: 80%",
    );

    // lastScannedAt을 과거로 → 변경됨으로 감지
    const oldResult = { ...firstResult, scannedAt: new Date(Date.now() - 10_000) };
    const { result, rescanned } = await scanner.scanIncremental(oldResult);

    expect(result.projects[0].progress.percentage).toBe(80);
    expect(rescanned).toBe(1);
  });

  it("삭제된 프로젝트는 결과에서 제거된다", async () => {
    const projectDir = path.join(tempRoot, "to-delete");
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, "README.md"), "# ToDelete");

    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const firstResult = await scanner.scan();
    expect(firstResult.projects).toHaveLength(1);

    // 프로젝트 폴더 삭제
    await fs.rm(projectDir, { recursive: true });

    const { result } = await scanner.scanIncremental(firstResult);
    expect(result.projects).toHaveLength(0);
  });

  it("새 프로젝트는 캐시에 없어도 자동으로 스캔된다", async () => {
    // 먼저 빈 스캔 결과 생성
    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const emptyResult = await scanner.scan();
    expect(emptyResult.projects).toHaveLength(0);

    // 새 프로젝트 추가
    const projectDir = path.join(tempRoot, "brand-new");
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, "README.md"), "# New");

    const { result, rescanned } = await scanner.scanIncremental(emptyResult);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe("brand-new");
    expect(rescanned).toBe(1);
  });
});
