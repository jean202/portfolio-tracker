import fs from "fs/promises";
import path from "path";
import type { ThreadSummary } from "../core/ProjectModel.js";

export interface ThreadCacheEntry {
  summary: ThreadSummary;
  fetchedAt: string; // ISO timestamp
}

interface ThreadCacheData {
  entries: Record<string, ThreadCacheEntry>;
}

const DEFAULT_FILE = path.join(process.cwd(), ".portfolio-tracker", "thread-cache.json");

export class ThreadCache {
  constructor(private readonly file: string = DEFAULT_FILE) {}

  private async load(): Promise<ThreadCacheData> {
    try {
      const content = await fs.readFile(this.file, "utf-8");
      return JSON.parse(content) as ThreadCacheData;
    } catch {
      return { entries: {} };
    }
  }

  async get(projectKey: string): Promise<ThreadCacheEntry | null> {
    const data = await this.load();
    return data.entries[projectKey] ?? null;
  }

  async save(projectKey: string, summary: ThreadSummary, fetchedAt: string): Promise<void> {
    const data = await this.load();
    data.entries[projectKey] = { summary, fetchedAt };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(data, null, 2), "utf-8");
  }
}
