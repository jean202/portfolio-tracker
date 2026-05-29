import type { ScanDiff, ProjectChange } from "./TrendAnalyzer.js";
import type { ScanResult } from "./ProjectModel.js";
import {
  hasMeaningfulNotificationChange,
  isMeaningfulProgressChange,
  type NotificationPolicyOptions,
} from "./NotificationPolicy.js";

export interface WebhookPayload {
  scannedAt: string;
  summary: {
    total: number;
    active: number;
    avgProgress: number | null;
    avgReadiness: number;
  };
  changes: {
    added: string[];
    removed: string[];
    changed: Array<{
      name: string;
      progressBefore: number | null;
      progressAfter: number | null;
      readinessBefore: number;
      readinessAfter: number;
    }>;
  };
}

export class WebhookNotifier {
  constructor(private readonly url: string) {}

  /**
   * diff에 유의미한 변경이 있으면 true.
   * - 새 프로젝트 추가됨
   * - 프로젝트 삭제됨
   * - 진행률 변화 절댓값 >= configured threshold
   */
  static shouldNotify(
    diff: ScanDiff,
    options: NotificationPolicyOptions = {},
  ): boolean {
    return hasMeaningfulNotificationChange(diff, options);
  }

  static buildPayload(
    diff: ScanDiff,
    after: ScanResult,
    options: NotificationPolicyOptions = {},
  ): WebhookPayload {
    const changed = diff.projects
      .filter(
        (p): p is ProjectChange & { status: "changed" } =>
          p.status === "changed" && isMeaningfulProgressChange(p, options),
      )
      .map((p) => ({
        name: p.name,
        progressBefore: p.before?.progress.percentage ?? null,
        progressAfter: p.after?.progress.percentage ?? null,
        readinessBefore: p.before?.readiness ?? 0,
        readinessAfter: p.after?.readiness ?? 0,
      }));

    return {
      scannedAt: after.scannedAt.toISOString(),
      summary: {
        total: after.summary.total,
        active: after.summary.active,
        avgProgress: after.summary.avgProgress,
        avgReadiness: after.summary.avgReadiness,
      },
      changes: {
        added: diff.projects
          .filter((p) => p.status === "new")
          .map((p) => p.name),
        removed: diff.projects
          .filter((p) => p.status === "removed")
          .map((p) => p.name),
        changed,
      },
    };
  }

  async notify(payload: WebhookPayload): Promise<void> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Webhook failed: ${res.status} ${res.statusText}`);
    }
  }
}
