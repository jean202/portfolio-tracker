export type ProjectType =
  | "node"
  | "python"
  | "dart"
  | "java"
  | "kotlin"
  | "go"
  | "rust"
  | "unknown";
export type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type ProgressSource =
  | "claude_md"
  | "readme"
  | "project_plan"
  | "todo"
  | "agents"
  | "docs"
  | "git_activity"
  | "heuristic"
  | "unknown";
export type Confidence = "high" | "medium" | "low";

export interface Progress {
  percentage: number | null;
  source: ProgressSource;
  confidence: Confidence;
  signals: string[];
  lastUpdated: Date;
  breakdown?: {
    completed: number;
    total: number;
  };
}

export interface Activity {
  lastCommitDate: Date | null;
  lastCommitMessage?: string;
  commitsInLastWeek: number;
  isActive: boolean;
  daysSinceLastCommit: number;
}

export interface Metadata {
  description: string;
  stack: string[];
  hasReadme: boolean;
  hasClaude: boolean;
  hasGit: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  type: ProjectType;

  progress: Progress;
  priority?: Priority;
  activity: Activity;
  metadata: Metadata;
  readiness: number; // 0-100: final score = min(100, baseReadiness + threadAdjustment)
  baseReadiness: number; // 0-100: filesystem-only score, never affected by ThreadKeeper
  continuity?: ContinuitySummary; // populated by ThreadEnricher when enabled

  nextActions?: string[];
  issues?: string[];

  scannedAt: Date;
}

export interface ScanResult {
  projects: Project[];
  scannedAt: Date;
  summary: {
    total: number;
    active: number;
    avgProgress: number | null;
    avgReadiness: number; // 0-100
    byPriority: Record<Priority, number>;
    byType: Record<ProjectType, number>;
  };
}

export interface SubAgentConfig {
  enabled?: boolean;
  baseUrl?: string;
  token?: string;
  tokenFile?: string;
  notifyOnScan?: boolean;
  notifyOnChanges?: boolean;
  openReportOnChanges?: boolean;
}

export interface KakaoConfig {
  enabled?: boolean;
  restApiKey?: string;
  clientSecret?: string;
  redirectUri?: string;
  tokenFile?: string;
  linkUrl?: string;
  notifyOnScan?: boolean;
  notifyOnChanges?: boolean;
}

export interface NotificationConfig {
  progressChangeThreshold?: number;
}

export interface Config {
  projectDirs: string[];
  scanInterval?: number;
  excludePatterns?: string[];
  webhookUrl?: string;
  subAgent?: SubAgentConfig;
  kakao?: KakaoConfig;
  notification?: NotificationConfig;
  threadKeeper?: ThreadKeeperConfig;
}

export type ThreadCoverage = "live" | "stale" | "unavailable";

// Mirrors ThreadKeeper GET /api/v1/threads response items (ThreadResponse).
export interface RawThread {
  id: number;
  projectKey: string;
  title: string;
  status: string; // ACTIVE | PAUSED | BLOCKED | COMPLETED
  priority: string; // CRITICAL | HIGH | MEDIUM | LOW
  originalIntent?: string | null;
  currentNextAction?: string | null;
  driftStatus?: string | null; // present in API, intentionally unused
  lastActivityAt?: string | null; // ISO timestamp
}

export interface ThreadSummaryItem {
  title: string;
  status: string;
  priority: string;
  currentNextAction?: string | null;
  lastActivityAt?: string | null;
}

export interface ThreadSummary {
  projectKey: string;
  total: number;
  active: number;
  completed: number;
  // most-recently-active thread; if none are active, the highest-priority thread. undefined when there are no threads.
  representative?: ThreadSummaryItem;
  activeThreads: ThreadSummaryItem[];
  mostRecentActivityAt?: string | null;
}

export interface ContinuitySummary {
  coverage: ThreadCoverage;
  summary?: ThreadSummary; // undefined when coverage === "unavailable"
  threadAdjustment: number; // 0-20
  signals: string[];
  fetchedAt?: string; // set when coverage === "stale"
  ageDays?: number; // set when coverage === "stale"
}

export interface ThreadKeeperConfig {
  enabled?: boolean; // default false
  baseUrl?: string; // default "http://localhost:8080"
  timeoutMs?: number; // default 2000
  staleMaxDays?: number; // default 14
  projectKeyOverrides?: Record<string, string>; // dir path OR dir name -> projectKey
}
