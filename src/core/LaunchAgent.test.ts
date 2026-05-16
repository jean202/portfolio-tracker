import { describe, expect, it } from "vitest";
import { createLaunchAgentPlist } from "./LaunchAgent.js";

describe("createLaunchAgentPlist", () => {
  it("creates a launchd plist for the watch command", () => {
    const plist = createLaunchAgentPlist({
      label: "com.example.portfolio-tracker",
      nodePath: "/usr/local/bin/node",
      cliPath: "/repo/dist/cli/index.js",
      workingDirectory: "/repo",
      logPath: "/tmp/watch.log",
      errorLogPath: "/tmp/watch.error.log",
      interval: "30m",
    });

    expect(plist).toContain("<string>com.example.portfolio-tracker</string>");
    expect(plist).toContain("<string>/usr/local/bin/node</string>");
    expect(plist).toContain("<string>/repo/dist/cli/index.js</string>");
    expect(plist).toContain("<string>watch</string>");
    expect(plist).toContain("<string>--interval</string>");
    expect(plist).toContain("<string>30m</string>");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<string>/repo</string>");
  });

  it("can skip the initial scan", () => {
    const plist = createLaunchAgentPlist({
      label: "com.example.portfolio-tracker",
      nodePath: "/usr/local/bin/node",
      cliPath: "/repo/dist/cli/index.js",
      workingDirectory: "/repo",
      logPath: "/tmp/watch.log",
      errorLogPath: "/tmp/watch.error.log",
      initial: false,
    });

    expect(plist).toContain("<string>--no-initial</string>");
  });

  it("escapes XML special characters", () => {
    const plist = createLaunchAgentPlist({
      label: "com.example.portfolio-tracker",
      nodePath: "/path/with&node",
      cliPath: "/repo/dist/cli/<index>.js",
      workingDirectory: '/repo/"quoted"',
      logPath: "/tmp/watch.log",
      errorLogPath: "/tmp/watch.error.log",
    });

    expect(plist).toContain("/path/with&amp;node");
    expect(plist).toContain("/repo/dist/cli/&lt;index&gt;.js");
    expect(plist).toContain("/repo/&quot;quoted&quot;");
  });
});
