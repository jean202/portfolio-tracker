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
  readiness: number; // 0-100: portfolio readiness score

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
}
