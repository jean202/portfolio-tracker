import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { ThreadCache } from "./ThreadCache.js";
import type { ThreadSummary } from "../core/ProjectModel.js";

function summary(): ThreadSummary {
  return {
    projectKey: "pt",
    total: 1,
    active: 1,
    completed: 0,
    activeThreads: [],
    mostRecentActivityAt: null,
  };
}

describe("ThreadCache", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "tk-cache-"));
    file = path.join(dir, "thread-cache.json");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns null for an unknown key when no file exists", async () => {
    const cache = new ThreadCache(file);
    expect(await cache.get("pt")).toBeNull();
  });

  it("saves and reloads a summary", async () => {
    const cache = new ThreadCache(file);
    await cache.save("pt", summary(), "2026-06-01T00:00:00Z");
    const entry = await cache.get("pt");
    expect(entry?.fetchedAt).toBe("2026-06-01T00:00:00Z");
    expect(entry?.summary.projectKey).toBe("pt");
  });

  it("preserves other keys when saving a new one", async () => {
    const cache = new ThreadCache(file);
    await cache.save("a", summary(), "2026-06-01T00:00:00Z");
    await cache.save("b", summary(), "2026-06-02T00:00:00Z");
    expect(await cache.get("a")).not.toBeNull();
    expect(await cache.get("b")).not.toBeNull();
  });
});
