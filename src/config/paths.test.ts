import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTokenFile } from "../core/KakaoNotifier.js";
import { ScanStore } from "../storage/ScanStore.js";
import { ConfigManager } from "./ConfigManager.js";
import {
  DATA_DIR_ENV,
  getConfigFile,
  getDataDir,
  migrateLegacyData,
} from "./paths.js";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "portfolio-tracker-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("getDataDir", () => {
  it("defaults to ~/.portfolio-tracker regardless of the working directory", () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/tester");
    vi.spyOn(process, "cwd").mockReturnValue("/somewhere/else");

    expect(getDataDir({})).toBe(
      path.join("/home/tester", ".portfolio-tracker"),
    );
  });

  it("uses PORTFOLIO_TRACKER_HOME when set", () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/tester");

    expect(getDataDir({ [DATA_DIR_ENV]: "/data/pt" })).toBe("/data/pt");
    expect(getDataDir({ [DATA_DIR_ENV]: "~/pt" })).toBe(
      path.join("/home/tester", "pt"),
    );
    expect(getDataDir({ [DATA_DIR_ENV]: "  " })).toBe(
      path.join("/home/tester", ".portfolio-tracker"),
    );
  });

  it("is used by the default config and scan store locations", () => {
    vi.stubEnv(DATA_DIR_ENV, tempRoot);

    expect(getConfigFile()).toBe(path.join(tempRoot, "config.json"));
    expect(new ConfigManager().path).toBe(path.join(tempRoot, "config.json"));
    expect(new ScanStore().path).toBe(path.join(tempRoot, "scan-result.json"));
  });
});

describe("resolveTokenFile", () => {
  it("maps the old cwd-relative default into the data directory", () => {
    vi.stubEnv(DATA_DIR_ENV, tempRoot);
    const expected = path.join(tempRoot, "kakao-token.json");

    expect(resolveTokenFile()).toBe(expected);
    expect(resolveTokenFile(".portfolio-tracker/kakao-token.json")).toBe(
      expected,
    );
    expect(resolveTokenFile("tokens/k.json")).toBe(
      path.join(tempRoot, "tokens", "k.json"),
    );
    expect(resolveTokenFile("/abs/k.json")).toBe("/abs/k.json");
  });
});

describe("migrateLegacyData", () => {
  async function writeLegacy(root: string) {
    await fs.mkdir(path.join(root, ".portfolio-tracker", "history"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, "config.json"),
      JSON.stringify({ projectDirs: ["~/work"] }),
    );
    await fs.writeFile(
      path.join(root, ".portfolio-tracker", "scan-result.json"),
      "{}",
    );
    await fs.writeFile(
      path.join(root, ".portfolio-tracker", "history", "1.json"),
      "{}",
    );
  }

  it("copies legacy files into a new data directory and keeps originals", async () => {
    const legacy = path.join(tempRoot, "repo");
    const dataDir = path.join(tempRoot, "home", ".portfolio-tracker");
    await writeLegacy(legacy);

    const migrated = await migrateLegacyData([legacy], dataDir);

    expect(migrated).toEqual(["config.json", "scan-result.json", "history"]);
    const config = JSON.parse(
      await fs.readFile(path.join(dataDir, "config.json"), "utf-8"),
    );
    expect(config.projectDirs).toEqual(["~/work"]);
    await expect(
      fs.access(path.join(dataDir, "history", "1.json")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(legacy, "config.json")),
    ).resolves.toBeUndefined();
  });

  it("does nothing once the data directory exists", async () => {
    const legacy = path.join(tempRoot, "repo");
    const dataDir = path.join(tempRoot, "data");
    await writeLegacy(legacy);
    await fs.mkdir(dataDir);

    await expect(migrateLegacyData([legacy], dataDir)).resolves.toEqual([]);
    await expect(fs.readdir(dataDir)).resolves.toEqual([]);
  });

  it("ignores a config.json that belongs to another tool", async () => {
    const other = path.join(tempRoot, "other-project");
    const dataDir = path.join(tempRoot, "data");
    await fs.mkdir(other);
    await fs.writeFile(
      path.join(other, "config.json"),
      JSON.stringify({ port: 3000 }),
    );

    await expect(migrateLegacyData([other], dataDir)).resolves.toEqual([]);
    await expect(fs.access(dataDir)).rejects.toThrow();
  });

  it("takes each item from the first root that has it", async () => {
    const cwdRoot = path.join(tempRoot, "cwd");
    const repoRoot = path.join(tempRoot, "repo");
    const dataDir = path.join(tempRoot, "data");
    await writeLegacy(repoRoot);
    await fs.mkdir(cwdRoot);
    await fs.writeFile(
      path.join(cwdRoot, "config.json"),
      JSON.stringify({ projectDirs: ["~/from-cwd"] }),
    );

    await migrateLegacyData([cwdRoot, repoRoot], dataDir);

    const config = JSON.parse(
      await fs.readFile(path.join(dataDir, "config.json"), "utf-8"),
    );
    expect(config.projectDirs).toEqual(["~/from-cwd"]);
    await expect(
      fs.access(path.join(dataDir, "scan-result.json")),
    ).resolves.toBeUndefined();
  });
});
