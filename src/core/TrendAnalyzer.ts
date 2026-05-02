import { ScanResult, Project } from "./ProjectModel.js";

export interface SummaryDiff {
  before: ScanResult["summary"];
  after: ScanResult["summary"];
  changes: {
    total: number;
    active: number;
    avgProgress: number | null;
    avgReadiness: number;
  };
}

export interface ProjectChange {
  name: string;
  before: Project | null;
  after: Project | null;
  status: "new" | "removed" | "changed" | "unchanged";
  progressChange: number | null; // null = 둘 다 null이거나 변화 없음
  readinessChange: number;
  activityChange: number; // daysSinceLastCommit 변화
}

export interface ScanDiff {
  fromDate: Date;
  toDate: Date;
  summary: SummaryDiff;
  projects: ProjectChange[];
}

export interface TrendDataPoint {
  scannedAt: Date;
  total: number;
  active: number;
  avgProgress: number | null;
  avgReadiness: number;
}

export interface ProjectTrendDataPoint {
  scannedAt: Date;
  percentage: number | null;
  confidence: string;
  readiness: number;
  daysSinceLastCommit: number;
}

export class TrendAnalyzer {
  /**
   * 두 스캔 결과를 비교
   */
  static diff(before: ScanResult, after: ScanResult): ScanDiff {
    const beforeMap = new Map(before.projects.map((p) => [p.name, p]));
    const afterMap = new Map(after.projects.map((p) => [p.name, p]));

    const allNames = new Set([...beforeMap.keys(), ...afterMap.keys()]);
    const projectChanges: ProjectChange[] = [];

    for (const name of allNames) {
      const beforeProject = beforeMap.get(name) ?? null;
      const afterProject = afterMap.get(name) ?? null;

      if (!beforeProject && afterProject) {
        projectChanges.push({
          name,
          before: null,
          after: afterProject,
          status: "new",
          progressChange: null,
          readinessChange: afterProject.readiness,
          activityChange: 0,
        });
      } else if (beforeProject && !afterProject) {
        projectChanges.push({
          name,
          before: beforeProject,
          after: null,
          status: "removed",
          progressChange: null,
          readinessChange: -beforeProject.readiness,
          activityChange: 0,
        });
      } else if (beforeProject && afterProject) {
        const progressChange = this.calculateProgressChange(
          beforeProject.progress.percentage,
          afterProject.progress.percentage,
        );
        const readinessChange = afterProject.readiness - beforeProject.readiness;
        const activityChange =
          afterProject.activity.daysSinceLastCommit -
          beforeProject.activity.daysSinceLastCommit;

        const isChanged =
          progressChange !== 0 || readinessChange !== 0 || activityChange !== 0;

        projectChanges.push({
          name,
          before: beforeProject,
          after: afterProject,
          status: isChanged ? "changed" : "unchanged",
          progressChange,
          readinessChange,
          activityChange,
        });
      }
    }

    const summary: SummaryDiff = {
      before: before.summary,
      after: after.summary,
      changes: {
        total: after.summary.total - before.summary.total,
        active: after.summary.active - before.summary.active,
        avgProgress:
          after.summary.avgProgress !== null && before.summary.avgProgress !== null
            ? after.summary.avgProgress - before.summary.avgProgress
            : null,
        avgReadiness: after.summary.avgReadiness - before.summary.avgReadiness,
      },
    };

    return {
      fromDate: before.scannedAt,
      toDate: after.scannedAt,
      summary,
      projects: projectChanges,
    };
  }

  /**
   * 여러 스캔 결과로부터 전체 트렌드 데이터 생성
   */
  static buildTrend(results: ScanResult[]): TrendDataPoint[] {
    return results.map((result) => ({
      scannedAt: result.scannedAt,
      total: result.summary.total,
      active: result.summary.active,
      avgProgress: result.summary.avgProgress,
      avgReadiness: result.summary.avgReadiness,
    }));
  }

  /**
   * 특정 프로젝트의 트렌드 데이터
   */
  static buildProjectTrend(
    results: ScanResult[],
    projectName: string,
  ): ProjectTrendDataPoint[] {
    const dataPoints: ProjectTrendDataPoint[] = [];

    for (const result of results) {
      const project = result.projects.find(
        (p) => p.name.toLowerCase() === projectName.toLowerCase(),
      );

      if (project) {
        dataPoints.push({
          scannedAt: result.scannedAt,
          percentage: project.progress.percentage,
          confidence: project.progress.confidence,
          readiness: project.readiness,
          daysSinceLastCommit: project.activity.daysSinceLastCommit,
        });
      }
    }

    return dataPoints;
  }

  /**
   * 가장 큰 변화를 보인 프로젝트 찾기 (진행률 기준)
   */
  static topMovers(diff: ScanDiff, count = 5): ProjectChange[] {
    return diff.projects
      .filter((p) => p.status === "changed" && p.progressChange !== null)
      .sort(
        (a, b) =>
          Math.abs(b.progressChange ?? 0) - Math.abs(a.progressChange ?? 0),
      )
      .slice(0, count);
  }

  private static calculateProgressChange(
    before: number | null,
    after: number | null,
  ): number | null {
    if (before === null && after === null) return 0;
    if (before === null && after !== null) return after;
    if (before !== null && after === null) return -before;
    if (before !== null && after !== null) return after - before;
    return null;
  }
}
