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
  options: { cwd?: string; home?: string } = {},
): Promise<string> {
  const { stdout } = await execFileAsync(tsxBin, [cliPath, ...args], {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      // 실제 ~/.portfolio-tracker를 건드리지 않도록 테스트마다 데이터 디렉토리 지정
      PORTFOLIO_TRACKER_HOME:
        options.home ??
        options.cwd ??
        path.join(os.tmpdir(), "portfolio-cli-unused"),
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });

  return stdout;
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

  it("reads the same config no matter which folder it runs from", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "portfolio-cli-"));
    const legacyDir = path.join(tempDir, "old-checkout");
    const otherDir = path.join(tempDir, "somewhere-else");
    const home = path.join(tempDir, "data");

    try {
      await fs.mkdir(legacyDir);
      await fs.mkdir(otherDir);
      await fs.writeFile(
        path.join(legacyDir, "config.json"),
        JSON.stringify({ projectDirs: ["~/legacy-projects"] }),
      );

      // 예전 위치에서 처음 실행하면 설정이 데이터 디렉토리로 복사된다
      const first = await runCli(["config", "list"], { cwd: legacyDir, home });
      expect(first).toContain("~/legacy-projects");
      expect(first).toContain(path.join(home, "config.json"));

      // 다른 폴더에서 실행해도 같은 설정을 읽는다
      const second = await runCli(["config", "list"], { cwd: otherDir, home });
      expect(second).toContain("~/legacy-projects");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);
});
