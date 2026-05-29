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
});
