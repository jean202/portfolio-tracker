import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const LAUNCH_AGENT_LABEL = "com.jean325.portfolio-tracker";

export interface LaunchAgentPaths {
  plistPath: string;
  logPath: string;
  errorLogPath: string;
}

export interface LaunchAgentPlistOptions {
  label: string;
  nodePath: string;
  cliPath: string;
  workingDirectory: string;
  logPath: string;
  errorLogPath: string;
  interval?: string;
  initial?: boolean;
}

export interface LaunchAgentInstallOptions {
  nodePath: string;
  cliPath: string;
  workingDirectory: string;
  interval?: string;
  initial?: boolean;
}

export class LaunchAgent {
  readonly label = LAUNCH_AGENT_LABEL;
  readonly paths: LaunchAgentPaths;

  constructor(private readonly home = os.homedir()) {
    this.paths = {
      plistPath: path.join(
        this.home,
        "Library",
        "LaunchAgents",
        `${this.label}.plist`,
      ),
      logPath: path.join(
        this.home,
        "Library",
        "Logs",
        "portfolio-tracker",
        "watch.log",
      ),
      errorLogPath: path.join(
        this.home,
        "Library",
        "Logs",
        "portfolio-tracker",
        "watch.error.log",
      ),
    };
  }

  async install(options: LaunchAgentInstallOptions): Promise<void> {
    ensureMacOS();
    await fs.mkdir(path.dirname(this.paths.plistPath), { recursive: true });
    await fs.mkdir(path.dirname(this.paths.logPath), { recursive: true });

    const plist = createLaunchAgentPlist({
      label: this.label,
      nodePath: options.nodePath,
      cliPath: options.cliPath,
      workingDirectory: options.workingDirectory,
      logPath: this.paths.logPath,
      errorLogPath: this.paths.errorLogPath,
      interval: options.interval,
      initial: options.initial,
    });

    await fs.writeFile(this.paths.plistPath, plist, "utf-8");
  }

  async start(): Promise<void> {
    ensureMacOS();
    await this.stop({ ignoreErrors: true });
    await execFileAsync("launchctl", [
      "bootstrap",
      this.domain,
      this.paths.plistPath,
    ]);
  }

  async stop(options: { ignoreErrors?: boolean } = {}): Promise<void> {
    ensureMacOS();
    try {
      await execFileAsync("launchctl", [
        "bootout",
        this.domain,
        this.paths.plistPath,
      ]);
    } catch (error) {
      if (!options.ignoreErrors) {
        throw error;
      }
    }
  }

  async uninstall(): Promise<void> {
    ensureMacOS();
    await this.stop({ ignoreErrors: true });
    await fs.rm(this.paths.plistPath, { force: true });
  }

  async isInstalled(): Promise<boolean> {
    try {
      await fs.access(this.paths.plistPath);
      return true;
    } catch {
      return false;
    }
  }

  async isRunning(): Promise<boolean> {
    ensureMacOS();
    try {
      await execFileAsync("launchctl", [
        "print",
        `${this.domain}/${this.label}`,
      ]);
      return true;
    } catch {
      return false;
    }
  }

  private get domain(): string {
    if (typeof process.getuid !== "function") {
      throw new Error("현재 환경에서 사용자 ID를 확인할 수 없습니다.");
    }
    return `gui/${process.getuid()}`;
  }
}

export function createLaunchAgentPlist(
  options: LaunchAgentPlistOptions,
): string {
  const programArguments = [
    options.nodePath,
    options.cliPath,
    "watch",
    ...(options.interval ? ["--interval", options.interval] : []),
    ...(options.initial === false ? ["--no-initial"] : []),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(options.label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments.map((arg) => `    <string>${escapeXml(arg)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(options.workingDirectory)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(options.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(options.errorLogPath)}</string>
</dict>
</plist>
`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function ensureMacOS(): void {
  if (process.platform !== "darwin") {
    throw new Error("자동 시작 서비스는 macOS launchd에서만 지원됩니다.");
  }
}
