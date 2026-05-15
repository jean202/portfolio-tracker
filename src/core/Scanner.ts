import fs from "fs/promises";
import path from "path";
import simpleGit from "simple-git";
import {
  Activity,
  Config,
  Priority,
  Progress,
  Project,
  ProjectType,
  ScanResult,
} from "./ProjectModel.js";
import { ConfigManager } from "../config/ConfigManager.js";

export interface ProjectCandidate {
  name: string;
  path: string;
  hasReadme: boolean;
  hasClaude: boolean;
  hasGit: boolean;
  packageJsonType?: ProjectType;
}

interface ProjectDocument {
  fileName: string;
  content: string;
  source: Progress["source"];
}

export class Scanner {
  private config: Config;
  private configManager: ConfigManager;

  constructor(config: Config) {
    this.config = config;
    this.configManager = new ConfigManager();
  }

  /**
   * 모든 프로젝트 디렉토리를 스캔해서 프로젝트 후보 찾기
   */
  async scanProjectDirs(): Promise<ProjectCandidate[]> {
    const expandedDirs = this.configManager.expandPaths(
      this.config.projectDirs,
    );
    const candidates: ProjectCandidate[] = [];

    for (const dir of expandedDirs) {
      try {
        const projectCandidates = await this.scanDirectory(dir);
        candidates.push(...projectCandidates);
      } catch (error) {
        console.warn(`Failed to scan directory ${dir}:`, error);
      }
    }

    return candidates;
  }

  async scan(): Promise<ScanResult> {
    const candidates = await this.scanProjectDirs();
    const projects = await Promise.all(
      candidates.map((candidate) => this.analyzeProject(candidate)),
    );
    const summary = this.buildSummary(projects);

    return {
      projects: this.sortProjects(projects),
      scannedAt: new Date(),
      summary,
    };
  }

  // 변경 감지 대상 파일 목록 (non-git 프로젝트용)
  private static readonly WATCHED_FILES = [
    "README.md", "readme.md",
    "CLAUDE.md",
    "AGENTS.md",
    "PROJECT_PLAN.md",
    "TODO.md", "TODO.txt",
    "package.json",
    "pubspec.yaml",
    "pom.xml",
    "build.gradle", "build.gradle.kts",
    "requirements.txt",
    "setup.py",
    "go.mod",
    "Cargo.toml",
  ];

  /**
   * 프로젝트가 lastScannedAt 이후 변경됐는지 판단.
   * - git 있음: 마지막 커밋 날짜 비교
   * - git 없음: 주요 파일 mtime 비교
   * 판단 불가(오류)시 true 반환(안전한 방향).
   */
  public async isProjectChanged(
    candidate: ProjectCandidate,
    lastScannedAt: Date,
  ): Promise<boolean> {
    if (candidate.hasGit) {
      try {
        const git = simpleGit(candidate.path);
        const log = await git.log({ maxCount: 1 });
        if (!log.latest) return true; // 커밋 없음 → 변경됨으로 간주
        const commitDate = new Date(log.latest.date);
        if (isNaN(commitDate.getTime())) return true; // unparseable date → rescan
        return commitDate > lastScannedAt;
      } catch {
        return true; // 오류 → 안전하게 재스캔
      }
    }

    // non-git: 주요 파일의 mtime 비교
    for (const fileName of Scanner.WATCHED_FILES) {
      try {
        const stat = await fs.stat(path.join(candidate.path, fileName));
        if (stat.mtimeMs > lastScannedAt.getTime()) return true;
      } catch {
        // 파일 없으면 건너뜀
      }
    }
    return false;
  }

  /**
   * 증분 스캔: lastResult 기준으로 변경된 프로젝트만 재분석.
   * - 변경됨 또는 새 프로젝트 → analyzeProject()
   * - 변경 없음 → lastResult 캐시 재사용
   * - 삭제된 프로젝트 → 결과에서 제거
   */
  async scanIncremental(
    lastResult: ScanResult,
  ): Promise<{ result: ScanResult; rescanned: number; reused: number }> {
    const candidates = await this.scanProjectDirs();
    const lastScannedAt = lastResult.scannedAt;

    // 캐시를 id로 빠르게 조회할 수 있도록 Map 생성
    const cachedById = new Map(
      lastResult.projects.map((p) => [p.id, p]),
    );

    const outcomes = await Promise.all(
      candidates.map(async (candidate) => {
        const id = this.slug(candidate.path);
        const cached = cachedById.get(id);

        if (cached) {
          const changed = await this.isProjectChanged(candidate, lastScannedAt);
          if (!changed) {
            return { project: cached, wasReused: true };
          }
        }

        return { project: await this.analyzeProject(candidate), wasReused: false };
      }),
    );

    const projects = outcomes.map((o) => o.project);
    const reused = outcomes.filter((o) => o.wasReused).length;
    const rescanned = outcomes.filter((o) => !o.wasReused).length;

    const sortedProjects = this.sortProjects(projects);

    const result: ScanResult = {
      projects: sortedProjects,
      scannedAt: new Date(),
      summary: this.buildSummary(sortedProjects),
    };

    return { result, rescanned, reused };
  }

  /**
   * 특정 디렉토리 내의 프로젝트 찾기
   * - 1단계: README.md 또는 package.json 등의 존재 확인
   * - 2단계: git 저장소 또는 메타데이터 확인
   */
  private async scanDirectory(dir: string): Promise<ProjectCandidate[]> {
    const candidates: ProjectCandidate[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;

        const projectPath = path.join(dir, entry.name);
        const candidate = await this.isProject(projectPath);

        if (candidate) {
          candidates.push(candidate);
        }
      }
    } catch (error) {
      console.warn(`Failed to read directory ${dir}:`, error);
    }

    return candidates;
  }

  /**
   * 폴더가 프로젝트인지 확인
   * 프로젝트 판단 기준:
   * - README.md 또는
   * - package.json / pubspec.yaml / pom.xml / requirements.txt 등 또는
   * - .git 디렉토리
   */
  private async isProject(
    projectPath: string,
  ): Promise<ProjectCandidate | null> {
    try {
      const entries = await fs.readdir(projectPath);

      // 프로젝트 판단 기준
      const hasReadme =
        entries.includes("README.md") || entries.includes("readme.md");
      const hasClaude = entries.includes("CLAUDE.md");
      const hasGit = entries.includes(".git");

      // 기술 스택 감지
      let packageJsonType: ProjectType | undefined;

      if (entries.includes("package.json")) packageJsonType = "node";
      else if (entries.includes("pubspec.yaml")) packageJsonType = "dart";
      else if (entries.includes("pom.xml")) packageJsonType = "java";
      else if (
        entries.includes("build.gradle") ||
        entries.includes("build.gradle.kts")
      )
        packageJsonType = "kotlin";
      else if (
        entries.includes("requirements.txt") ||
        entries.includes("setup.py")
      )
        packageJsonType = "python";
      else if (entries.includes("Cargo.toml")) packageJsonType = "rust";
      else if (entries.includes("go.mod")) packageJsonType = "go";

      // 프로젝트로 판단하는 기준: README 또는 메타파일이 있으면 OK
      if (hasReadme || hasClaude || hasGit || packageJsonType) {
        return {
          name: path.basename(projectPath),
          path: projectPath,
          hasReadme,
          hasClaude,
          hasGit,
          packageJsonType,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  private async analyzeProject(candidate: ProjectCandidate): Promise<Project> {
    const [documents, activity] = await Promise.all([
      this.readProjectDocuments(candidate.path),
      this.detectActivity(candidate),
    ]);
    const progress = this.detectProgress(documents);
    const readme = this.documentContent(documents, ["README.md", "readme.md"]);
    const claude = this.documentContent(documents, ["CLAUDE.md"]);
    const planText = documents.map((document) => document.content).join("\n");
    const text = `${readme}\n${claude}\n${planText}`;
    const issues = this.detectIssues(candidate, progress, activity);

    return {
      id: this.slug(candidate.path),
      name: candidate.name,
      path: candidate.path,
      type: candidate.packageJsonType ?? "unknown",
      progress,
      priority: this.detectPriority(text, progress, activity, issues),
      activity,
      metadata: {
        description: this.detectDescription(readme, claude),
        stack: this.detectStack(candidate.packageJsonType, text),
        hasReadme: candidate.hasReadme,
        hasClaude: candidate.hasClaude,
        hasGit: candidate.hasGit,
      },
      readiness: this.calculateReadiness(progress, activity, {
        hasReadme: candidate.hasReadme,
        hasClaude: candidate.hasClaude,
        hasGit: candidate.hasGit,
      }, candidate.packageJsonType),
      nextActions: this.detectNextActions(text),
      issues,
      scannedAt: new Date(),
    };
  }

  private detectProgress(documents: ProjectDocument[]): Progress {
    for (const document of documents) {
      const explicit = document.content.match(
        /(?:progress|진행률|완성도|완료율|complete|completion)\D{0,24}(\d{1,3})\s*%/i,
      );
      if (explicit) {
        return {
          percentage: Math.min(Number(explicit[1]), 100),
          source: document.source,
          confidence: "high",
          signals: [`${document.fileName}: explicit ${explicit[1]}% progress`],
          lastUpdated: new Date(),
        };
      }
    }

    const checkboxStats = this.detectCheckboxProgress(documents);
    if (checkboxStats.total > 0) {
      return {
        percentage: Math.round(
          (checkboxStats.completed / checkboxStats.total) * 100,
        ),
        source: checkboxStats.source,
        confidence: checkboxStats.total >= 4 ? "high" : "medium",
        signals: [
          `${checkboxStats.completed}/${checkboxStats.total} checklist items completed`,
          ...checkboxStats.files.map((fileName) => `${fileName}: checklist`),
        ],
        lastUpdated: new Date(),
        breakdown: {
          completed: checkboxStats.completed,
          total: checkboxStats.total,
        },
      };
    }

    const heuristic = this.detectHeuristicProgress(documents);
    if (heuristic) {
      return heuristic;
    }

    return {
      percentage: null,
      source: "unknown",
      confidence: "low",
      signals: ["No reliable progress signal found"],
      lastUpdated: new Date(),
    };
  }

  private async detectActivity(candidate: ProjectCandidate): Promise<Activity> {
    if (!candidate.hasGit) {
      return {
        lastCommitDate: null,
        commitsInLastWeek: 0,
        isActive: false,
        daysSinceLastCommit: Number.MAX_SAFE_INTEGER,
      };
    }

    try {
      const git = simpleGit(candidate.path);
      const log = await git.log({ maxCount: 50 });
      const latest = log.latest;
      const lastCommitDate = latest ? new Date(latest.date) : null;
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const commitsInLastWeek = log.all.filter(
        (commit) => new Date(commit.date).getTime() >= weekAgo,
      ).length;
      const daysSinceLastCommit = lastCommitDate
        ? Math.floor(
            (Date.now() - lastCommitDate.getTime()) / (24 * 60 * 60 * 1000),
          )
        : Number.MAX_SAFE_INTEGER;

      return {
        lastCommitDate,
        lastCommitMessage: latest?.message,
        commitsInLastWeek,
        isActive: daysSinceLastCommit <= 14,
        daysSinceLastCommit,
      };
    } catch {
      return {
        lastCommitDate: null,
        commitsInLastWeek: 0,
        isActive: false,
        daysSinceLastCommit: Number.MAX_SAFE_INTEGER,
      };
    }
  }

  private detectPriority(
    text: string,
    progress: Progress,
    activity: Activity,
    issues: string[],
  ): Priority {
    if (
      /critical|긴급|최우선|blocked|블로커/i.test(text) ||
      issues.includes("Git 저장소 없음")
    ) {
      return "CRITICAL";
    }
    if (/high|높음|우선/i.test(text)) return "HIGH";
    if (
      progress.percentage !== null &&
      progress.percentage > 0 &&
      progress.percentage < 80 &&
      activity.isActive
    )
      return "HIGH";
    if (
      progress.percentage !== null &&
      progress.percentage >= 80 &&
      issues.length > 0
    )
      return "MEDIUM";
    if (activity.isActive) return "MEDIUM";
    return "LOW";
  }

  private detectIssues(
    candidate: ProjectCandidate,
    progress: Progress,
    activity: Activity,
  ): string[] {
    const issues: string[] = [];
    if (!candidate.hasReadme) issues.push("README 없음");
    if (!candidate.hasGit) issues.push("Git 저장소 없음");
    if (progress.percentage === null) issues.push("진행률 판단 불가");
    if (
      activity.daysSinceLastCommit > 30 &&
      activity.daysSinceLastCommit < Number.MAX_SAFE_INTEGER
    ) {
      issues.push("30일 이상 커밋 없음");
    }
    return issues;
  }

  private detectDescription(readme: string, claude: string): string {
    const source = readme || claude;
    const firstMeaningfulLine = source
      .split("\n")
      .map((line) => line.trim().replace(/^#+\s*/, ""))
      .find((line) => line.length > 0 && !line.startsWith("!["));

    return firstMeaningfulLine ?? "";
  }

  private detectStack(type: ProjectType | undefined, text: string): string[] {
    const stack = new Set<string>();
    if (type && type !== "unknown") stack.add(type);

    const checks: Array<[RegExp, string]> = [
      [/react/i, "React"],
      [/next\.?js/i, "Next.js"],
      [/typescript|타입스크립트/i, "TypeScript"],
      [/node\.?js/i, "Node.js"],
      [/spring/i, "Spring"],
      [/fastapi/i, "FastAPI"],
      [/django/i, "Django"],
      [/flutter/i, "Flutter"],
      [/docker/i, "Docker"],
    ];

    checks.forEach(([pattern, label]) => {
      if (pattern.test(text)) stack.add(label);
    });

    return [...stack];
  }

  private detectNextActions(text: string): string[] {
    const actions = text
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          /^[-*]\s+\[\s\]\s+/.test(line) ||
          /^(todo|next|다음|할 일)[:：]/i.test(line),
      )
      .map((line) =>
        line
          .replace(/^[-*]\s+\[\s\]\s+/, "")
          .replace(/^(todo|next|다음|할 일)[:：]\s*/i, ""),
      )
      .filter(Boolean);

    return actions.slice(0, 5);
  }

  private buildSummary(projects: Project[]): ScanResult["summary"] {
    const byPriority = this.emptyPriorityCount();
    const byType = this.emptyTypeCount();
    let progressTotal = 0;
    let readinessTotal = 0;

    projects.forEach((project) => {
      byPriority[project.priority ?? "LOW"] += 1;
      byType[project.type] += 1;
      if (project.progress.percentage !== null) {
        progressTotal += project.progress.percentage;
      }
      readinessTotal += project.readiness;
    });
    const knownProgressProjects = projects.filter(
      (project) => project.progress.percentage !== null,
    );

    return {
      total: projects.length,
      active: projects.filter((project) => project.activity.isActive).length,
      avgProgress:
        knownProgressProjects.length === 0
          ? null
          : Math.round(progressTotal / knownProgressProjects.length),
      avgReadiness: projects.length === 0 ? 0 : Math.round(readinessTotal / projects.length),
      byPriority,
      byType,
    };
  }

  private sortProjects(projects: Project[]): Project[] {
    const priorityOrder: Record<Priority, number> = {
      CRITICAL: 0,
      HIGH: 1,
      MEDIUM: 2,
      LOW: 3,
    };
    return [...projects].sort((a, b) => {
      const diff =
        priorityOrder[a.priority ?? "LOW"] -
        priorityOrder[b.priority ?? "LOW"];
      if (diff !== 0) return diff;
      return b.activity.daysSinceLastCommit - a.activity.daysSinceLastCommit;
    });
  }

  private calculateReadiness(
    progress: Progress,
    activity: Activity,
    metadata: { hasReadme: boolean; hasClaude: boolean; hasGit: boolean },
    type: ProjectType | undefined,
  ): number {
    let score = 0;

    // Progress quality: 0-30점
    if (progress.percentage !== null) {
      score += (progress.percentage / 100) * 20;
      if (progress.confidence === "high") score += 10;
      else if (progress.confidence === "medium") score += 5;
    }

    // Activity quality: 0-25점
    if (activity.isActive) {
      score += 25;
    } else if (activity.daysSinceLastCommit < 60 && activity.daysSinceLastCommit !== Number.MAX_SAFE_INTEGER) {
      score += 15;
    } else if (activity.daysSinceLastCommit < 180 && activity.daysSinceLastCommit !== Number.MAX_SAFE_INTEGER) {
      score += 8;
    }

    // Metadata quality: 0-25점
    if (metadata.hasReadme) score += 10;
    if (metadata.hasClaude) score += 10;
    if (metadata.hasGit) score += 5;

    // Type maturity: 0-20점
    if (type && type !== "unknown") {
      score += 20;
    }

    return Math.min(100, Math.round(score));
  }

  private emptyPriorityCount(): Record<Priority, number> {
    return {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
    };
  }

  private emptyTypeCount(): Record<ProjectType, number> {
    return {
      node: 0,
      python: 0,
      dart: 0,
      java: 0,
      kotlin: 0,
      go: 0,
      rust: 0,
      unknown: 0,
    };
  }

  private async readOptionalFile(
    dir: string,
    fileNames: string[],
  ): Promise<string> {
    for (const fileName of fileNames) {
      try {
        return await fs.readFile(path.join(dir, fileName), "utf-8");
      } catch {
        // Try the next known filename.
      }
    }

    return "";
  }

  private async readProjectDocuments(
    projectPath: string,
  ): Promise<ProjectDocument[]> {
    const documents: ProjectDocument[] = [];
    const knownFiles: Array<[string[], Progress["source"]]> = [
      [["CLAUDE.md"], "claude_md"],
      [["PROJECT_PLAN.md"], "project_plan"],
      [["README.md", "readme.md"], "readme"],
      [["AGENTS.md"], "agents"],
      [["TODO.md", "TODO.txt"], "todo"],
      [["mvp-plan.md"], "project_plan"],
    ];

    for (const [fileNames, source] of knownFiles) {
      const document = await this.readOptionalDocument(
        projectPath,
        fileNames,
        source,
      );
      if (document) {
        documents.push(document);
      }
    }

    const docsDir = path.join(projectPath, "docs");
    try {
      const entries = await fs.readdir(docsDir, { withFileTypes: true });
      const markdownFiles = entries
        .filter(
          (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
        )
        .map((entry) => entry.name)
        .sort();

      for (const fileName of markdownFiles) {
        const content = await this.readOptionalFile(docsDir, [fileName]);
        if (content) {
          documents.push({
            fileName: path.join("docs", fileName),
            content,
            source: "docs",
          });
        }
      }
    } catch {
      // docs/ is optional.
    }

    return documents;
  }

  private documentContent(
    documents: ProjectDocument[],
    fileNames: string[],
  ): string {
    const wanted = new Set(fileNames.map((fileName) => fileName.toLowerCase()));
    return (
      documents.find((document) => wanted.has(document.fileName.toLowerCase()))
        ?.content ?? ""
    );
  }

  private async readOptionalDocument(
    dir: string,
    fileNames: string[],
    source: Progress["source"],
  ): Promise<ProjectDocument | null> {
    for (const fileName of fileNames) {
      try {
        return {
          fileName,
          content: await fs.readFile(path.join(dir, fileName), "utf-8"),
          source,
        };
      } catch {
        // Try the next known filename.
      }
    }

    return null;
  }

  private detectCheckboxProgress(documents: ProjectDocument[]): {
    completed: number;
    total: number;
    source: Progress["source"];
    files: string[];
  } {
    let completed = 0;
    let total = 0;
    let source: Progress["source"] = "unknown";
    const files: string[] = [];

    for (const document of documents) {
      const checkboxes = [
        ...document.content.matchAll(/^\s*[-*]\s+\[( |x|X)\]\s+/gm),
      ];
      if (checkboxes.length === 0) continue;

      if (source === "unknown") source = document.source;
      files.push(document.fileName);
      total += checkboxes.length;
      completed += checkboxes.filter(
        (match) => match[1].toLowerCase() === "x",
      ).length;
    }

    return { completed, total, source, files };
  }

  private detectHeuristicProgress(
    documents: ProjectDocument[],
  ): Progress | null {
    const text = documents.map((document) => document.content).join("\n");
    const signals: string[] = [];
    let score: number | null = null;

    const addSignal = (pattern: RegExp, percentage: number, signal: string) => {
      if (pattern.test(text)) {
        signals.push(signal);
        score = Math.max(score ?? 0, percentage);
      }
    };

    addSignal(
      /(?:mvp|1차|핵심 기능).{0,20}(?:완료|done|complete)/i,
      70,
      "MVP/core feature completion mentioned",
    );
    addSignal(
      /(?:배포|deploy|release|production).{0,24}(?:완료|done|success|됨)/i,
      85,
      "Deployment/release completion mentioned",
    );
    addSignal(
      /(?:테스트|test|qa).{0,20}(?:필요|부족|todo|남음)/i,
      60,
      "Testing remains",
    );
    addSignal(
      /(?:초안|아이디어|draft|prototype|설계 중)/i,
      20,
      "Early-stage wording found",
    );
    addSignal(/(?:진행 중|in progress|wip)/i, 45, "In-progress wording found");

    if (score === null) return null;

    return {
      percentage: score,
      source: "heuristic",
      confidence: "low",
      signals,
      lastUpdated: new Date(),
    };
  }

  private slug(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, "-")
      .replace(/^-|-$/g, "");
  }
}
