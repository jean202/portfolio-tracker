import fs from "fs/promises";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import type { ScanResult, SubAgentConfig } from "./ProjectModel.js";
import type { ScanDiff } from "./TrendAnalyzer.js";
import {
  countMeaningfulProgressChanges,
  hasMeaningfulNotificationChange,
  type NotificationPolicyOptions,
} from "./NotificationPolicy.js";

export interface SubAgentTask {
  id: string;
  action: string;
  status: "queued" | "running" | "succeeded" | "failed";
  result?: unknown;
  error?: {
    message?: string;
  } | null;
}

export interface SubAgentTaskResponse {
  task: SubAgentTask;
}

export interface SubAgentClientOptions {
  baseUrl?: string;
  token?: string;
  tokenFile?: string;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:4877";

export class SubAgentClient {
  private readonly baseUrl: string;
  private readonly explicitToken?: string;
  private readonly tokenFile?: string;

  constructor(options: SubAgentClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.explicitToken = options.token;
    this.tokenFile = options.tokenFile
      ? expandHome(options.tokenFile)
      : undefined;
  }

  static fromConfig(config?: SubAgentConfig): SubAgentClient | null {
    if (!config?.enabled) {
      return null;
    }

    return new SubAgentClient({
      baseUrl: config.baseUrl,
      token: config.token,
      tokenFile: config.tokenFile,
    });
  }

  async health(): Promise<unknown> {
    return this.request("GET", "/health", undefined, false);
  }

  async runTask(
    action: string,
    args: Record<string, unknown> = {},
    options: { wait?: boolean } = {},
  ): Promise<SubAgentTask> {
    const payload = (await this.request("POST", "/tasks", {
      action,
      args,
    })) as SubAgentTaskResponse;

    if (options.wait === false) {
      return payload.task;
    }

    return this.waitForTask(payload.task.id);
  }

  async notify(title: string, message: string): Promise<SubAgentTask> {
    return this.runTask("notification.show", { title, message });
  }

  async openFile(filePath: string): Promise<SubAgentTask> {
    return this.runTask("url.open", {
      url: pathToFileURL(path.resolve(filePath)).toString(),
    });
  }

  private async waitForTask(taskId: string): Promise<SubAgentTask> {
    for (;;) {
      const payload = (await this.request(
        "GET",
        `/tasks/${encodeURIComponent(taskId)}`,
      )) as SubAgentTaskResponse;
      const task = payload.task;

      if (!["queued", "running"].includes(task.status)) {
        if (task.status === "failed") {
          throw new Error(task.error?.message ?? "Sub-agent task failed.");
        }
        return task;
      }

      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  private async request(
    method: string,
    pathname: string,
    body?: unknown,
    authenticated = true,
  ): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (authenticated) {
      headers.authorization = `Bearer ${await this.readToken()}`;
    }

    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message =
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "object" &&
        payload.error &&
        "message" in payload.error
          ? String(payload.error.message)
          : `Sub-agent HTTP ${response.status}`;
      throw new Error(message);
    }

    return payload;
  }

  private async readToken(): Promise<string> {
    if (this.explicitToken) {
      return this.explicitToken;
    }

    if (!this.tokenFile) {
      throw new Error(
        "subAgent.tokenFile 또는 subAgent.token 설정이 필요합니다.",
      );
    }

    return (await fs.readFile(this.tokenFile, "utf-8")).trim();
  }
}

export function shouldNotifySubAgent(
  config: SubAgentConfig | undefined,
  diff: ScanDiff | null,
  options: NotificationPolicyOptions = {},
): boolean {
  if (!config?.enabled) {
    return false;
  }

  if (config.notifyOnScan) {
    return true;
  }

  if (config.notifyOnChanges && diff) {
    return hasMeaningfulNotificationChange(diff, options);
  }

  return false;
}

export function buildScanNotification(
  result: ScanResult,
  diff: ScanDiff | null,
  options: NotificationPolicyOptions = {},
): { title: string; message: string } {
  const progress = result.summary.avgProgress ?? "판단 불가";
  const base = `${result.summary.total}개 프로젝트 · 활성 ${result.summary.active}개 · 평균 진행률 ${progress}% · 준비도 ${result.summary.avgReadiness}%`;

  if (!diff) {
    return {
      title: "Portfolio Tracker 스캔 완료",
      message: base,
    };
  }

  const added = diff.projects.filter(
    (project) => project.status === "new",
  ).length;
  const removed = diff.projects.filter(
    (project) => project.status === "removed",
  ).length;
  const changed = countMeaningfulProgressChanges(diff, options);
  const topMover = diff.projects
    .filter(
      (project) =>
        project.progressChange !== null && project.progressChange !== 0,
    )
    .sort(
      (a, b) =>
        Math.abs(b.progressChange ?? 0) - Math.abs(a.progressChange ?? 0),
    )[0];
  const hasChangeSummary = added !== 0 || removed !== 0 || changed !== 0;

  const changeSummary = hasChangeSummary
    ? `신규 ${added} · 제거 ${removed} · 진행률 변화 ${changed}`
    : "큰 변화 없음";
  const moverSummary = topMover
    ? ` · 최대 변화 ${topMover.name} ${formatSigned(topMover.progressChange ?? 0)}%p`
    : "";

  return {
    title: hasChangeSummary
      ? "Portfolio Tracker 변화 감지"
      : "Portfolio Tracker 스캔 완료",
    message: `${changeSummary}${moverSummary}\n${base}`,
  };
}

export function hasMeaningfulChange(diff: ScanDiff): boolean {
  return hasMeaningfulNotificationChange(diff);
}

function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function formatSigned(value: number): string {
  if (value > 0) return `+${value}`;
  return `${value}`;
}
