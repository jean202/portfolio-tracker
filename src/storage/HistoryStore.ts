import fs from "fs/promises";
import path from "path";
import { getHistoryDir } from "../config/paths.js";
import { ScanResult } from "../core/ProjectModel.js";

/**
 * 히스토리 항목의 메타데이터.
 * 파일 경로는 timestamp 기반으로 결정됨.
 */
export interface HistoryEntry {
  timestamp: number;
  scannedAt: Date;
  filePath: string;
}

export class HistoryStore {
  constructor(private readonly historyDir = getHistoryDir()) {}

  get dir(): string {
    return this.historyDir;
  }

  /**
   * 새 스캔 결과를 히스토리에 저장.
   * 파일명은 timestamp 기반 (예: 1714508039000.json)
   */
  async save(result: ScanResult): Promise<string> {
    await fs.mkdir(this.historyDir, { recursive: true });

    const timestamp = result.scannedAt.getTime();
    const fileName = `${timestamp}.json`;
    const filePath = path.join(this.historyDir, fileName);

    await fs.writeFile(filePath, `${JSON.stringify(result, null, 2)}\n`);
    return filePath;
  }

  /**
   * 모든 히스토리 항목 조회 (최신순)
   */
  async list(): Promise<HistoryEntry[]> {
    try {
      const entries = await fs.readdir(this.historyDir);
      const historyEntries: HistoryEntry[] = [];

      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;

        const match = entry.match(/^(\d+)\.json$/);
        if (!match) continue;

        const timestamp = parseInt(match[1], 10);
        if (isNaN(timestamp)) continue;

        historyEntries.push({
          timestamp,
          scannedAt: new Date(timestamp),
          filePath: path.join(this.historyDir, entry),
        });
      }

      // 최신순 정렬
      return historyEntries.sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      return [];
    }
  }

  /**
   * 특정 시점의 스캔 결과 로드
   */
  async loadByTimestamp(timestamp: number): Promise<ScanResult | null> {
    const filePath = path.join(this.historyDir, `${timestamp}.json`);
    return this.loadFile(filePath);
  }

  /**
   * 가장 최근 N개의 스캔 결과 로드 (최신순)
   */
  async loadRecent(count: number): Promise<ScanResult[]> {
    const entries = await this.list();
    const recentEntries = entries.slice(0, count);
    const results: ScanResult[] = [];

    for (const entry of recentEntries) {
      const result = await this.loadFile(entry.filePath);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * 특정 기간의 스캔 결과 로드
   */
  async loadInRange(from: Date, to: Date): Promise<ScanResult[]> {
    const entries = await this.list();
    const inRange = entries.filter(
      (e) => e.timestamp >= from.getTime() && e.timestamp <= to.getTime(),
    );

    const results: ScanResult[] = [];
    for (const entry of inRange.reverse()) {
      // 오래된 순으로 정렬
      const result = await this.loadFile(entry.filePath);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * 가장 최근 스캔 결과
   */
  async loadLatest(): Promise<ScanResult | null> {
    const entries = await this.list();
    if (entries.length === 0) return null;
    return this.loadFile(entries[0].filePath);
  }

  /**
   * 두 번째로 최근 스캔 결과 (diff용)
   */
  async loadPrevious(): Promise<ScanResult | null> {
    const entries = await this.list();
    if (entries.length < 2) return null;
    return this.loadFile(entries[1].filePath);
  }

  /**
   * 오래된 히스토리 정리 (선택사항)
   * @param keepCount 보관할 최대 개수
   */
  async prune(keepCount: number): Promise<number> {
    const entries = await this.list();
    if (entries.length <= keepCount) return 0;

    const toDelete = entries.slice(keepCount);
    for (const entry of toDelete) {
      await fs.unlink(entry.filePath).catch(() => {
        // 파일이 이미 없을 수 있음
      });
    }

    return toDelete.length;
  }

  private async loadFile(filePath: string): Promise<ScanResult | null> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
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
