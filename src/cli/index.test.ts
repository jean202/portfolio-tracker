import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const tsxBin = path.join(repoRoot, "node_modules/.bin/tsx");
const cliPath = path.join(repoRoot, "src/cli/index.ts");

async function runCli(
  args: string[],
  options: { cwd?: string } = {},
): Promise<string> {
  const { stdout } = await execFileAsync(tsxBin, [cliPath, ...args], {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });

  return stdout;
}

async function runCliExpectingFailure(
  args: string[],
  options: { cwd?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    await execFileAsync(tsxBin, [cliPath, ...args], {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    });
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string };
    return {
      code: failure.code,
      stdout: failure.stdout,
      stderr: failure.stderr,
    };
  }
  throw new Error(`Expected CLI to fail: ${args.join(" ")}`);
}

async function withEmptyConfig<T>(fn: (dir: string) => Promise<T>) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "portfolio-cli-"));
  try {
    await fs.writeFile(
      path.join(tempDir, "config.json"),
      JSON.stringify({ projectDirs: [] }),
    );
    return await fn(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

describe("CLI command registration", () => {
  it("shows notification command groups in help output", async () => {
    const agentHelp = await runCli(["agent", "--help"]);
    const kakaoHelp = await runCli(["kakao", "--help"]);
    const configAgentHelp = await runCli(["config", "agent", "--help"]);
    const configKakaoHelp = await runCli(["config", "kakao", "--help"]);
    const configNotificationsHelp = await runCli([
      "config",
      "notifications",
      "--help",
    ]);

    expect(agentHelp).toContain("open-report");
    expect(kakaoHelp).toContain("auth");
    expect(configAgentHelp).toContain("--open-report-on-changes");
    expect(configKakaoHelp).toContain("--rest-api-key");
    expect(configNotificationsHelp).toContain("--progress-threshold");
  }, 15_000);

  it("writes sub-agent settings through config agent", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "portfolio-cli-"));

    try {
      await runCli(
        [
          "config",
          "agent",
          "--enable",
          "--base-url",
          "http://127.0.0.1:4877",
          "--token-file",
          "/tmp/sub-agent-token",
          "--notify-on-scan",
          "false",
          "--notify-on-changes",
          "true",
          "--open-report-on-changes",
          "true",
        ],
        { cwd: tempDir },
      );

      const config = JSON.parse(
        await fs.readFile(path.join(tempDir, "config.json"), "utf-8"),
      );

      expect(config.subAgent).toMatchObject({
        enabled: true,
        baseUrl: "http://127.0.0.1:4877",
        tokenFile: "/tmp/sub-agent-token",
        notifyOnScan: false,
        notifyOnChanges: true,
        openReportOnChanges: true,
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("writes shared notification policy through config notifications", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "portfolio-cli-"));

    try {
      await runCli(["config", "notifications", "--progress-threshold", "8"], {
        cwd: tempDir,
      });

      const config = JSON.parse(
        await fs.readFile(path.join(tempDir, "config.json"), "utf-8"),
      );

      expect(config.notification).toMatchObject({
        progressChangeThreshold: 8,
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("shows actionable kakao status diagnostics", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "portfolio-cli-"));
    const tokenFile = path.join(tempDir, "kakao-token.json");

    try {
      await fs.writeFile(
        tokenFile,
        JSON.stringify({
          tokenType: "bearer",
          accessToken: "access",
          accessTokenExpiresAt: new Date(Date.now() + 120_000).toISOString(),
          refreshToken: "refresh",
          refreshTokenExpiresAt: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          scope: "profile",
        }),
      );
      await fs.writeFile(
        path.join(tempDir, "config.json"),
        JSON.stringify(
          {
            projectDirs: [],
            kakao: {
              enabled: true,
              restApiKey: "rest-key",
              tokenFile,
              linkUrl: "https://example.com/report",
            },
          },
          null,
          2,
        ),
      );

      const output = await runCli(["kakao", "status"], { cwd: tempDir });

      expect(output).toContain("talk_message 권한: ✗");
      expect(output).toContain("Web domain 후보: https://example.com");
      expect(output).toContain("토큰 scope에 talk_message 권한이 없습니다.");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);
});

describe("CLI input validation and exit codes", () => {
  it("rejects an invalid watch interval without a stack trace", async () => {
    const { code, stderr } = await runCliExpectingFailure([
      "watch",
      "--once",
      "--interval",
      "5x",
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain("'5x' is invalid");
    expect(stderr).toContain("예: 30m, 2h, 1d");
    expect(stderr).not.toMatch(/\bat .+:\d+:\d+/);
  }, 15_000);

  it("rejects non-numeric counts and ranges", async () => {
    for (const args of [
      ["recommend", "-n", "abc"],
      ["history", "-n", "abc"],
      ["trends", "-n", "0"],
      ["diff", "-n", "x"],
      ["search", "--min-progress", "abc"],
      ["search", "--max-progress", "150"],
    ]) {
      const { code, stderr } = await runCliExpectingFailure(args);
      expect(code, args.join(" ")).toBe(1);
      expect(stderr, args.join(" ")).toContain("is invalid");
    }
  }, 60_000);

  it("exits with 1 when detail cannot find the project", async () => {
    await withEmptyConfig(async (cwd) => {
      const { code, stderr } = await runCliExpectingFailure(
        ["detail", "no-such-project"],
        { cwd },
      );

      expect(code).toBe(1);
      expect(stderr).toContain("프로젝트를 찾을 수 없습니다: no-such-project");
    });
  }, 15_000);

  it("prints thrown errors as one line and exits with 1", async () => {
    await withEmptyConfig(async (cwd) => {
      const { code, stderr } = await runCliExpectingFailure(
        ["export", "--format", "pdf"],
        { cwd },
      );

      expect(code).toBe(1);
      expect(stderr).toContain("✗ 지원하지 않는 export 형식입니다: pdf");
      expect(stderr).not.toMatch(/\bat .+:\d+:\d+/);
    });
  }, 15_000);
});
