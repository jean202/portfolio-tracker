import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigManager } from "./ConfigManager.js";

let tempRoot: string;
let configPath: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "portfolio-tracker-"));
  configPath = path.join(tempRoot, "config.json");
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("ConfigManager", () => {
  it("uses default config when the config file does not exist", async () => {
    const manager = new ConfigManager(configPath);
    const config = await manager.load();

    expect(config.projectDirs).toContain("~/portfolio/projects");
    expect(config.excludePatterns).toContain("node_modules");
  });

  it("adds and removes project directories", async () => {
    const manager = new ConfigManager(configPath);

    await expect(manager.addProjectDir("~/NewProjects")).resolves.toBe(true);
    await expect(manager.addProjectDir("~/NewProjects")).resolves.toBe(false);

    let config = await manager.load();
    expect(config.projectDirs).toContain("~/NewProjects");

    await expect(manager.removeProjectDir("~/NewProjects")).resolves.toBe(true);
    await expect(manager.removeProjectDir("~/NewProjects")).resolves.toBe(
      false,
    );

    config = await manager.load();
    expect(config.projectDirs).not.toContain("~/NewProjects");
  });

  it("expands tilde paths", () => {
    const manager = new ConfigManager(configPath);
    const home = process.env.HOME || "";

    expect(manager.expandPath("~/Projects")).toBe(path.join(home, "Projects"));
    expect(manager.expandPath("/tmp/Projects")).toBe("/tmp/Projects");
  });
});
