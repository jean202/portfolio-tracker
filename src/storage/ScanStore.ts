import fs from "fs/promises";
import path from "path";
import { ScanResult } from "../core/ProjectModel.js";
import { HistoryStore } from "./HistoryStore.js";

const DEFAULT_STORE_FILE = path.join(
  process.cwd(),
  ".portfolio-tracker",
  "scan-result.json",
);

export class ScanStore {
  private readonly historyStore: HistoryStore;

  constructor(
    private readonly filePath = DEFAULT_STORE_FILE,
    historyStore?: HistoryStore,
  ) {
    this.historyStore = historyStore ?? new HistoryStore();
  }

  get path(): string {
    return this.filePath;
  }

  async save(result: ScanResult): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(result, null, 2)}\n`);
    // 히스토리에도 자동 저장
    await this.historyStore.save(result);
  }

  async load(): Promise<ScanResult | null> {
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      return this.revive(JSON.parse(content) as ScanResult);
    } catch {
      return null;
    }
  }

  private revive(result: ScanResult): ScanResult {
    return {
      ...result,
      scannedAt: new Date(result.scannedAt),
      projects: result.projects.map((project) => ({
        ...project,
        scannedAt: new Date(project.scannedAt),
        progress: {
          ...project.progress,
          lastUpdated: new Date(project.progress.lastUpdated),
        },
        activity: {
          ...project.activity,
          lastCommitDate: project.activity.lastCommitDate
            ? new Date(project.activity.lastCommitDate)
            : null,
        },
      })),
    };
  }
}
