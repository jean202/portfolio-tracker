#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { ConfigManager } from "../config/ConfigManager.js";
import { Scanner } from "../core/Scanner.js";
import { TrendAnalyzer } from "../core/TrendAnalyzer.js";
import { renderHtmlReport } from "../report/HtmlReport.js";
import { renderJsonReport } from "../report/JsonReport.js";
import { renderMarkdownReport } from "../report/MarkdownReport.js";
import { HistoryStore } from "../storage/HistoryStore.js";
import { ScanStore } from "../storage/ScanStore.js";

const program = new Command();

program
  .name("portfolio-tracker")
  .description("포트폴리오 프로젝트 자동 추적 도구")
  .version("0.1.0");

// init 커맨드
program
  .command("init")
  .description("portfolio-tracker 초기화 (config.json 생성)")
  .option("--non-interactive", "대화형 모드 사용 안 함 (기본값만 사용)")
  .action(async (options: { nonInteractive?: boolean }) => {
    const configManager = new ConfigManager();
    const interactive = !options.nonInteractive;
    const config = await configManager.init(interactive);

    console.log();
    console.log(chalk.green("✓ portfolio-tracker 초기화 완료!"));
    console.log(chalk.gray("config.json이 생성되었습니다."));
    console.log();
    console.log(chalk.cyan("등록된 프로젝트 디렉토리:"));
    config.projectDirs.forEach((dir) => {
      console.log(chalk.gray(`  - ${dir}`));
    });
    console.log();
    console.log(chalk.blue("다음 단계:"));
    console.log(chalk.blue("  portfolio-tracker config list     # 설정 확인"));
    console.log(chalk.blue("  portfolio-tracker report --refresh # 스캔 & 리포트"));
  });

// scan 커맨드 (구현 진행 중)
program
  .command("scan")
  .description("프로젝트 디렉토리 스캔")
  .option("--no-save", "스캔 결과를 파일로 저장하지 않음")
  .action(async (options: { save?: boolean }) => {
    const configManager = new ConfigManager();
    const config = await configManager.load();

    console.log(chalk.blue("🔍 프로젝트 스캔 중..."));

    const scanner = new Scanner(config);
    const result = await scanner.scan();

    console.log(
      chalk.green(`✓ ${result.projects.length}개의 프로젝트를 찾았습니다!\n`),
    );

    result.projects.forEach((project) => {
      console.log(chalk.cyan(project.name));
      console.log(`  경로: ${project.path}`);
      console.log(`  README: ${project.metadata.hasReadme ? "✓" : "✗"}`);
      console.log(`  CLAUDE.md: ${project.metadata.hasClaude ? "✓" : "✗"}`);
      console.log(`  Git: ${project.metadata.hasGit ? "✓" : "✗"}`);
      console.log(`  타입: ${project.type}`);
      console.log(`  진행률: ${project.progress.percentage}%`);
      console.log();
    });

    if (options.save !== false) {
      const store = new ScanStore();
      await store.save(result);
      console.log(chalk.gray(`스캔 결과 저장: ${store.path}`));
    }

    console.log(chalk.gray("다음 단계: portfolio-tracker report"));
  });

// report 커맨드
program
  .command("report")
  .description("프로젝트 진행 리포트 출력")
  .option("-a, --all", "LOW 우선순위 프로젝트까지 모두 표시")
  .option("-r, --refresh", "저장된 결과 대신 새로 스캔")
  .action(async (options: { all?: boolean; refresh?: boolean }) => {
    console.log(chalk.blue("프로젝트 리포트 생성 중..."));
    const { result, fromCache } = await loadScanResult({
      refresh: options.refresh,
    });
    const projects = options.all
      ? result.projects
      : result.projects.filter((project) => project.priority !== "LOW");

    console.log();
    console.log(chalk.cyan("요약"));
    console.log(`  전체 프로젝트: ${result.summary.total}`);
    console.log(`  최근 활성: ${result.summary.active}`);
    console.log(`  평균 진행률: ${formatProgress(result.summary.avgProgress)}`);
    console.log(`  포트폴리오 준비도: ${result.summary.avgReadiness}%`);
    console.log(`  스캔 시각: ${formatDateTime(result.scannedAt)}`);
    console.log(`  데이터: ${fromCache ? "저장된 결과" : "새 스캔 결과"}`);
    console.log(
      `  우선순위: CRITICAL ${result.summary.byPriority.CRITICAL}, HIGH ${result.summary.byPriority.HIGH}, MEDIUM ${result.summary.byPriority.MEDIUM}, LOW ${result.summary.byPriority.LOW}`,
    );
    console.log();

    if (projects.length === 0) {
      console.log(
        chalk.gray(
          "표시할 프로젝트가 없습니다. --all 옵션으로 LOW 우선순위까지 볼 수 있습니다.",
        ),
      );
      return;
    }

    const table = new Table({
      head: ["우선순위", "프로젝트", "타입", "진행률", "준비도", "최근 활동", "이슈"],
      wordWrap: true,
      colWidths: [12, 24, 12, 10, 8, 16, 36],
    });

    projects.forEach((project) => {
      table.push([
        formatPriority(project.priority),
        project.name,
        project.type,
        formatProgress(project.progress.percentage),
        `${project.readiness}%`,
        formatActivity(project.activity.daysSinceLastCommit),
        project.issues?.join(", ") || "-",
      ]);
    });

    console.log(table.toString());

    const actionable = projects.filter(
      (project) => project.nextActions && project.nextActions.length > 0,
    );
    if (actionable.length > 0) {
      console.log();
      console.log(chalk.cyan("다음 작업"));
      actionable.slice(0, 5).forEach((project) => {
        console.log(chalk.yellow(`  ${project.name}`));
        project.nextActions?.slice(0, 3).forEach((action) => {
          console.log(chalk.gray(`    - ${action}`));
        });
      });
    }
  });

// export 커맨드
program
  .command("export")
  .description("스캔 결과를 Markdown, HTML, JSON 파일로 내보내기")
  .option(
    "-f, --format <format>",
    "출력 형식: markdown, html, json",
    "markdown",
  )
  .option("-o, --output <file>", "출력 파일")
  .option("-a, --all", "LOW 우선순위 프로젝트까지 모두 포함")
  .option("-r, --refresh", "저장된 결과 대신 새로 스캔")
  .action(
    async (options: {
      format: string;
      output?: string;
      all?: boolean;
      refresh?: boolean;
    }) => {
      const { result, fromCache } = await loadScanResult({
        refresh: options.refresh,
      });
      const format = normalizeExportFormat(options.format);
      const outputPath = path.resolve(
        process.cwd(),
        options.output ?? defaultExportPath(format),
      );
      const content = renderExportContent(format, result, {
        includeLowPriority: options.all,
      });

      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, content, "utf-8");

      console.log(
        chalk.green(`✓ ${format.toUpperCase()} 리포트 생성: ${outputPath}`),
      );
      console.log(
        chalk.gray(`데이터: ${fromCache ? "저장된 결과" : "새 스캔 결과"}`),
      );
    },
  );

// detail 커맨드
program
  .command("detail")
  .alias("d")
  .argument("<project>")
  .description("프로젝트 상세 정보 보기")
  .option("-r, --refresh", "저장된 결과 대신 새로 스캔")
  .action(async (projectName: string, options: { refresh?: boolean }) => {
    const { result } = await loadScanResult({ refresh: options.refresh });
    const project = result.projects.find(
      (p) => p.name.toLowerCase() === projectName.toLowerCase(),
    );

    if (!project) {
      console.log(
        chalk.red(
          `✗ 프로젝트를 찾을 수 없습니다: ${projectName}`,
        ),
      );
      console.log();
      console.log(chalk.gray("등록된 프로젝트:"));
      result.projects.forEach((p) => console.log(chalk.gray(`  - ${p.name}`)));
      return;
    }

    console.log();
    console.log(chalk.cyan.bold(`📁 ${project.name}`));
    console.log(chalk.gray(project.path));
    console.log();

    // 기본 정보
    console.log(chalk.cyan("기본 정보"));
    console.log(`  타입: ${chalk.yellow(project.type)}`);
    console.log(
      `  우선순위: ${chalk.bold(
        formatPriority(project.priority ?? "LOW"),
      )}`,
    );
    console.log(
      `  설명: ${project.metadata.description || chalk.gray("없음")}`,
    );
    console.log();

    // 진행률 상세
    console.log(chalk.cyan("진행률"));
    console.log(
      `  완료도: ${
        project.progress.percentage === null
          ? chalk.gray("판단 불가")
          : chalk.bold(`${project.progress.percentage}%`)
      }`,
    );
    console.log(`  신뢰도: ${chalk.yellow(project.progress.confidence)}`);
    console.log(`  근거 (Signals):`);
    project.progress.signals.forEach((signal) => {
      console.log(chalk.gray(`    - ${signal}`));
    });
    if (project.progress.breakdown) {
      console.log(
        `  체크박스: ${project.progress.breakdown.completed}/${project.progress.breakdown.total} 완료`,
      );
    }
    console.log();

    // 활동 정보
    console.log(chalk.cyan("활동"));
    console.log(
      `  마지막 커밋: ${
        project.activity.lastCommitDate
          ? formatDateTime(project.activity.lastCommitDate)
          : chalk.gray("없음")
      }`,
    );
    if (project.activity.lastCommitMessage) {
      console.log(
        `  메시지: ${chalk.gray(project.activity.lastCommitMessage.substring(0, 60))}`,
      );
    }
    console.log(
      `  지난 7일 커밋: ${chalk.yellow(project.activity.commitsInLastWeek)}개`,
    );
    console.log(
      `  상태: ${
        project.activity.isActive ? chalk.green("활성") : chalk.gray("휴휴")
      }`,
    );
    console.log();

    // 문서 정보
    console.log(chalk.cyan("문서"));
    console.log(
      `  README: ${project.metadata.hasReadme ? chalk.green("✓") : chalk.gray("✗")}`,
    );
    console.log(
      `  CLAUDE.md: ${project.metadata.hasClaude ? chalk.green("✓") : chalk.gray("✗")}`,
    );
    console.log(
      `  Git: ${project.metadata.hasGit ? chalk.green("✓") : chalk.gray("✗")}`,
    );
    console.log();

    // 기술 스택
    if (project.metadata.stack.length > 0) {
      console.log(chalk.cyan("기술 스택"));
      console.log(
        `  ${project.metadata.stack.map((s) => chalk.yellow(s)).join(", ")}`,
      );
      console.log();
    }

    // 준비도
    console.log(chalk.cyan("포트폴리오 준비도"));
    console.log(`  점수: ${chalk.bold(`${project.readiness}%`)}`);
    console.log();

    // 이슈
    if (project.issues && project.issues.length > 0) {
      console.log(chalk.cyan("이슈"));
      project.issues.forEach((issue) => {
        console.log(chalk.red(`  ⚠ ${issue}`));
      });
      console.log();
    }

    // 다음 작업
    if (project.nextActions && project.nextActions.length > 0) {
      console.log(chalk.cyan("다음 작업"));
      project.nextActions.forEach((action) => {
        console.log(chalk.gray(`  - ${action}`));
      });
      console.log();
    }
  });

// stats 커맨드
program
  .command("stats")
  .description("포트폴리오 통계 요약")
  .option("-r, --refresh", "저장된 결과 대신 새로 스캔")
  .action(async (options: { refresh?: boolean }) => {
    const { result } = await loadScanResult({ refresh: options.refresh });
    const projects = result.projects;

    console.log();
    console.log(chalk.cyan.bold("📊 포트폴리오 통계"));
    console.log();

    // 전체 요약
    console.log(chalk.cyan("개요"));
    console.log(`  전체 프로젝트: ${chalk.bold(result.summary.total)}`);
    console.log(
      `  활성 프로젝트: ${chalk.green(result.summary.active)} (${Math.round((result.summary.active / Math.max(result.summary.total, 1)) * 100)}%)`,
    );
    console.log(
      `  평균 진행률: ${chalk.bold(formatProgress(result.summary.avgProgress))}`,
    );
    console.log(`  포트폴리오 준비도: ${chalk.bold(`${result.summary.avgReadiness}%`)}`);
    console.log();

    // 우선순위별 분포
    console.log(chalk.cyan("우선순위별"));
    const priorityTable = new Table({
      head: ["우선순위", "프로젝트 수", "비율"],
      colWidths: [12, 14, 10],
    });
    (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).forEach((priority) => {
      const count = result.summary.byPriority[priority];
      const ratio = Math.round((count / Math.max(result.summary.total, 1)) * 100);
      priorityTable.push([
        formatPriority(priority),
        count.toString(),
        `${ratio}%`,
      ]);
    });
    console.log(priorityTable.toString());
    console.log();

    // 기술 스택별 분포
    console.log(chalk.cyan("기술 타입별"));
    const typeTable = new Table({
      head: ["타입", "프로젝트 수", "비율"],
      colWidths: [12, 14, 10],
    });
    Object.entries(result.summary.byType)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)
      .forEach(([type, count]) => {
        const ratio = Math.round((count / Math.max(result.summary.total, 1)) * 100);
        typeTable.push([type, count.toString(), `${ratio}%`]);
      });
    console.log(typeTable.toString());
    console.log();

    // 진행률 분포
    console.log(chalk.cyan("진행률 분포"));
    const ranges = [
      { label: "0-25%", min: 0, max: 25 },
      { label: "25-50%", min: 25, max: 50 },
      { label: "50-75%", min: 50, max: 75 },
      { label: "75-99%", min: 75, max: 99 },
      { label: "100%", min: 100, max: 101 },
    ];
    const progressDistTable = new Table({
      head: ["범위", "개수", "프로젝트"],
      colWidths: [12, 8, 50],
      wordWrap: true,
    });
    ranges.forEach(({ label, min, max }) => {
      const inRange = projects.filter(
        (p) =>
          p.progress.percentage !== null &&
          p.progress.percentage >= min &&
          p.progress.percentage < max,
      );
      progressDistTable.push([
        label,
        inRange.length.toString(),
        inRange.map((p) => p.name).join(", ") || "-",
      ]);
    });
    const unknownProjects = projects.filter(
      (p) => p.progress.percentage === null,
    );
    progressDistTable.push([
      "판단 불가",
      unknownProjects.length.toString(),
      unknownProjects.map((p) => p.name).join(", ") || "-",
    ]);
    console.log(progressDistTable.toString());
    console.log();

    // 활동성 분포
    console.log(chalk.cyan("활동성"));
    const activityRanges = [
      {
        label: "이번 주 (0-7일)",
        check: (p: typeof projects[0]) => p.activity.daysSinceLastCommit <= 7,
      },
      {
        label: "최근 (8-30일)",
        check: (p: typeof projects[0]) =>
          p.activity.daysSinceLastCommit > 7 &&
          p.activity.daysSinceLastCommit <= 30,
      },
      {
        label: "오래됨 (31-90일)",
        check: (p: typeof projects[0]) =>
          p.activity.daysSinceLastCommit > 30 &&
          p.activity.daysSinceLastCommit <= 90,
      },
      {
        label: "잊혀짐 (90일+)",
        check: (p: typeof projects[0]) =>
          p.activity.daysSinceLastCommit > 90 &&
          p.activity.daysSinceLastCommit < Number.MAX_SAFE_INTEGER,
      },
      {
        label: "Git 없음",
        check: (p: typeof projects[0]) =>
          p.activity.daysSinceLastCommit === Number.MAX_SAFE_INTEGER,
      },
    ];
    activityRanges.forEach(({ label, check }) => {
      const count = projects.filter(check).length;
      const bar = "█".repeat(count) + "░".repeat(Math.max(0, 20 - count));
      console.log(`  ${label.padEnd(20)} ${chalk.cyan(bar)} ${count}`);
    });
    console.log();
  });

// recommend 커맨드
program
  .command("recommend")
  .alias("reco")
  .description("작업하기 좋은 프로젝트 추천")
  .option("-r, --refresh", "저장된 결과 대신 새로 스캔")
  .option("-n, --count <count>", "추천 개수", "3")
  .action(async (options: { refresh?: boolean; count: string }) => {
    const { result } = await loadScanResult({ refresh: options.refresh });
    const count = parseInt(options.count, 10) || 3;
    const projects = result.projects;

    // 추천 점수 계산
    const scoredProjects = projects.map((p) => {
      let score = 0;
      const reasons: string[] = [];

      // 우선순위
      if (p.priority === "CRITICAL") {
        score += 30;
        reasons.push("CRITICAL 우선순위");
      } else if (p.priority === "HIGH") {
        score += 20;
        reasons.push("HIGH 우선순위");
      }

      // 활성도
      if (p.activity.isActive) {
        score += 15;
        reasons.push("최근 활동 있음");
      }

      // 거의 완료된 프로젝트는 마무리하기 좋음
      if (
        p.progress.percentage !== null &&
        p.progress.percentage >= 70 &&
        p.progress.percentage < 100
      ) {
        score += 25;
        reasons.push(`완성도 ${p.progress.percentage}% - 마무리 단계`);
      }

      // 다음 작업이 명확함
      if (p.nextActions && p.nextActions.length > 0) {
        score += 10;
        reasons.push(`구체적인 다음 작업 ${p.nextActions.length}개`);
      }

      // 이슈가 적음
      if (!p.issues || p.issues.length === 0) {
        score += 10;
        reasons.push("막힘 없음");
      }

      return { project: p, score, reasons };
    });

    // 잊혀진 프로젝트 (최근 활동 없는데 진행률 좋음)
    const forgotten = projects.filter(
      (p) =>
        p.activity.daysSinceLastCommit > 14 &&
        p.activity.daysSinceLastCommit < Number.MAX_SAFE_INTEGER &&
        p.progress.percentage !== null &&
        p.progress.percentage >= 30 &&
        p.progress.percentage < 90 &&
        p.priority !== "LOW",
    );

    console.log();
    console.log(chalk.cyan.bold("🎯 작업 추천"));
    console.log();

    // 오늘 작업할 프로젝트
    console.log(chalk.cyan(`✨ 오늘 작업하기 좋은 프로젝트 TOP ${count}`));
    scoredProjects
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
      .forEach(({ project, score, reasons }, idx) => {
        console.log();
        console.log(
          `${chalk.bold(`${idx + 1}.`)} ${chalk.yellow(project.name)} ${chalk.gray(`(${score}점)`)}`,
        );
        console.log(`   ${chalk.gray("이유:")}`);
        reasons.forEach((reason) => {
          console.log(`     ${chalk.green("✓")} ${reason}`);
        });
        if (project.nextActions && project.nextActions.length > 0) {
          console.log(`   ${chalk.gray("다음 작업:")}`);
          project.nextActions.slice(0, 2).forEach((action) => {
            console.log(`     ${chalk.gray("→")} ${action}`);
          });
        }
      });
    console.log();

    // 잊혀진 프로젝트
    if (forgotten.length > 0) {
      console.log(chalk.cyan("💭 잊고 계신 프로젝트"));
      console.log(
        chalk.gray("  (2주 이상 활동 없지만 30% 이상 진행된 프로젝트)"),
      );
      console.log();
      forgotten.slice(0, 5).forEach((p) => {
        console.log(
          `  ${chalk.yellow(p.name)} - ${chalk.bold(`${p.progress.percentage}%`)} 완료, ${chalk.gray(`${p.activity.daysSinceLastCommit}일 전 마지막 활동`)}`,
        );
      });
      console.log();
    } else {
      console.log(chalk.green("✓ 잊고 있는 프로젝트가 없습니다!"));
      console.log();
    }
  });

// search 커맨드
program
  .command("search")
  .alias("s")
  .argument("[keyword]")
  .description("프로젝트 검색")
  .option("-r, --refresh", "저장된 결과 대신 새로 스캔")
  .option("-t, --type <type>", "타입으로 필터링 (node, python, dart 등)")
  .option(
    "-p, --priority <priority>",
    "우선순위로 필터링 (CRITICAL, HIGH, MEDIUM, LOW)",
  )
  .option("--min-progress <progress>", "최소 진행률 (0-100)")
  .option("--max-progress <progress>", "최대 진행률 (0-100)")
  .option("--min-readiness <readiness>", "최소 준비도 (0-100)")
  .option("--active", "활성 프로젝트만")
  .option("--has-issues", "이슈가 있는 프로젝트만")
  .action(
    async (
      keyword: string | undefined,
      options: {
        refresh?: boolean;
        type?: string;
        priority?: string;
        minProgress?: string;
        maxProgress?: string;
        minReadiness?: string;
        active?: boolean;
        hasIssues?: boolean;
      },
    ) => {
      const { result } = await loadScanResult({ refresh: options.refresh });
      let filtered = result.projects;

      // 키워드 검색
      if (keyword) {
        const lower = keyword.toLowerCase();
        filtered = filtered.filter(
          (p) =>
            p.name.toLowerCase().includes(lower) ||
            p.metadata.description.toLowerCase().includes(lower) ||
            p.metadata.stack.some((s) => s.toLowerCase().includes(lower)),
        );
      }

      // 타입 필터
      if (options.type) {
        filtered = filtered.filter((p) => p.type === options.type);
      }

      // 우선순위 필터
      if (options.priority) {
        filtered = filtered.filter(
          (p) => p.priority === options.priority?.toUpperCase(),
        );
      }

      // 진행률 필터
      if (options.minProgress !== undefined) {
        const min = parseInt(options.minProgress, 10);
        filtered = filtered.filter(
          (p) => p.progress.percentage !== null && p.progress.percentage >= min,
        );
      }
      if (options.maxProgress !== undefined) {
        const max = parseInt(options.maxProgress, 10);
        filtered = filtered.filter(
          (p) => p.progress.percentage !== null && p.progress.percentage <= max,
        );
      }

      // 준비도 필터
      if (options.minReadiness !== undefined) {
        const min = parseInt(options.minReadiness, 10);
        filtered = filtered.filter((p) => p.readiness >= min);
      }

      // 활성 필터
      if (options.active) {
        filtered = filtered.filter((p) => p.activity.isActive);
      }

      // 이슈 필터
      if (options.hasIssues) {
        filtered = filtered.filter((p) => p.issues && p.issues.length > 0);
      }

      console.log();
      console.log(
        chalk.cyan.bold(`🔍 검색 결과: ${filtered.length}개 프로젝트`),
      );
      console.log();

      if (filtered.length === 0) {
        console.log(chalk.gray("일치하는 프로젝트가 없습니다."));
        return;
      }

      const table = new Table({
        head: ["프로젝트", "타입", "우선순위", "진행률", "준비도", "활동"],
        colWidths: [24, 10, 12, 10, 8, 16],
        wordWrap: true,
      });

      filtered.forEach((p) => {
        table.push([
          p.name,
          p.type,
          formatPriority(p.priority),
          formatProgress(p.progress.percentage),
          `${p.readiness}%`,
          formatActivity(p.activity.daysSinceLastCommit),
        ]);
      });

      console.log(table.toString());
    },
  );

// history 커맨드
program
  .command("history")
  .alias("hist")
  .argument("[project]", "특정 프로젝트의 히스토리 (선택)")
  .description("스캔 히스토리 보기")
  .option("-n, --count <count>", "표시할 항목 수", "10")
  .action(async (projectName: string | undefined, options: { count: string }) => {
    const historyStore = new HistoryStore();
    const count = parseInt(options.count, 10) || 10;
    const results = await historyStore.loadRecent(count);

    if (results.length === 0) {
      console.log(chalk.gray("히스토리가 없습니다. 먼저 스캔을 실행하세요."));
      console.log(chalk.gray("  portfolio-tracker scan"));
      return;
    }

    console.log();
    if (projectName) {
      // 특정 프로젝트 히스토리
      const trend = TrendAnalyzer.buildProjectTrend(results, projectName);

      if (trend.length === 0) {
        console.log(
          chalk.red(`✗ 히스토리에서 프로젝트를 찾을 수 없습니다: ${projectName}`),
        );
        return;
      }

      console.log(chalk.cyan.bold(`📈 ${projectName} - 진행 추이`));
      console.log();

      const table = new Table({
        head: ["시각", "진행률", "신뢰도", "준비도", "마지막 활동"],
        colWidths: [22, 10, 10, 10, 14],
      });

      // 오래된 순
      [...trend].reverse().forEach((point) => {
        table.push([
          formatDateTime(point.scannedAt),
          formatProgress(point.percentage),
          point.confidence,
          `${point.readiness}%`,
          formatActivity(point.daysSinceLastCommit),
        ]);
      });

      console.log(table.toString());
      console.log();

      // 변화 요약
      if (trend.length >= 2) {
        const oldest = trend[trend.length - 1];
        const newest = trend[0];
        const progressChange =
          oldest.percentage !== null && newest.percentage !== null
            ? newest.percentage - oldest.percentage
            : null;
        const readinessChange = newest.readiness - oldest.readiness;

        console.log(chalk.cyan("변화 요약"));
        if (progressChange !== null) {
          console.log(
            `  진행률: ${formatChange(progressChange, "%p")}`,
          );
        }
        console.log(`  준비도: ${formatChange(readinessChange, "%p")}`);
        console.log();
      }
    } else {
      // 전체 히스토리
      console.log(chalk.cyan.bold("📅 스캔 히스토리"));
      console.log();

      const table = new Table({
        head: ["시각", "전체", "활성", "평균진행률", "준비도"],
        colWidths: [22, 8, 8, 14, 12],
      });

      results.forEach((result) => {
        table.push([
          formatDateTime(result.scannedAt),
          result.summary.total.toString(),
          result.summary.active.toString(),
          formatProgress(result.summary.avgProgress),
          `${result.summary.avgReadiness}%`,
        ]);
      });

      console.log(table.toString());
      console.log();
      console.log(
        chalk.gray(`총 ${results.length}개의 스캔 기록 (저장 위치: ${historyStore.dir})`),
      );
      console.log();
    }
  });

// diff 커맨드
program
  .command("diff")
  .description("이전 스캔과 비교")
  .option(
    "-n, --against <count>",
    "비교 대상 (1=가장 최근 이전, 2=2번째 이전 ...)",
    "1",
  )
  .action(async (options: { against: string }) => {
    const historyStore = new HistoryStore();
    const againstIdx = parseInt(options.against, 10) || 1;
    const results = await historyStore.loadRecent(againstIdx + 1);

    if (results.length < 2) {
      console.log(chalk.gray("비교할 이전 스캔이 없습니다."));
      console.log(chalk.gray("최소 두 번의 스캔이 필요합니다."));
      console.log(chalk.gray("  portfolio-tracker scan"));
      return;
    }

    const after = results[0];
    const before = results[Math.min(againstIdx, results.length - 1)];

    const diff = TrendAnalyzer.diff(before, after);

    console.log();
    console.log(chalk.cyan.bold("📊 스캔 비교"));
    console.log(
      chalk.gray(
        `  ${formatDateTime(diff.fromDate)} → ${formatDateTime(diff.toDate)}`,
      ),
    );
    console.log();

    // 요약 변화
    console.log(chalk.cyan("요약 변화"));
    console.log(
      `  전체 프로젝트: ${diff.summary.before.total} → ${diff.summary.after.total} (${formatChange(diff.summary.changes.total, "")})`,
    );
    console.log(
      `  활성 프로젝트: ${diff.summary.before.active} → ${diff.summary.after.active} (${formatChange(diff.summary.changes.active, "")})`,
    );
    console.log(
      `  평균 진행률: ${formatProgress(diff.summary.before.avgProgress)} → ${formatProgress(diff.summary.after.avgProgress)} (${
        diff.summary.changes.avgProgress !== null
          ? formatChange(diff.summary.changes.avgProgress, "%p")
          : chalk.gray("-")
      })`,
    );
    console.log(
      `  준비도: ${diff.summary.before.avgReadiness}% → ${diff.summary.after.avgReadiness}% (${formatChange(diff.summary.changes.avgReadiness, "%p")})`,
    );
    console.log();

    // 새 프로젝트
    const newProjects = diff.projects.filter((p) => p.status === "new");
    if (newProjects.length > 0) {
      console.log(chalk.cyan(`✨ 새 프로젝트 (${newProjects.length}개)`));
      newProjects.forEach((p) => {
        console.log(`  ${chalk.green("+")} ${p.name}`);
      });
      console.log();
    }

    // 사라진 프로젝트
    const removedProjects = diff.projects.filter((p) => p.status === "removed");
    if (removedProjects.length > 0) {
      console.log(chalk.cyan(`💀 사라진 프로젝트 (${removedProjects.length}개)`));
      removedProjects.forEach((p) => {
        console.log(`  ${chalk.red("-")} ${p.name}`);
      });
      console.log();
    }

    // 가장 큰 변화 (TOP movers)
    const movers = TrendAnalyzer.topMovers(diff, 10);
    if (movers.length > 0) {
      console.log(chalk.cyan("🚀 변화가 큰 프로젝트"));
      const table = new Table({
        head: ["프로젝트", "이전", "현재", "변화", "준비도 변화"],
        colWidths: [24, 10, 10, 12, 14],
      });

      movers.forEach((m) => {
        const before = m.before?.progress.percentage;
        const after = m.after?.progress.percentage;
        table.push([
          m.name,
          formatProgress(before ?? null),
          formatProgress(after ?? null),
          m.progressChange !== null
            ? formatChange(m.progressChange, "%p")
            : chalk.gray("-"),
          formatChange(m.readinessChange, "%p"),
        ]);
      });

      console.log(table.toString());
      console.log();
    }

    // 변화 없음 통계
    const unchanged = diff.projects.filter((p) => p.status === "unchanged").length;
    const changed = diff.projects.filter((p) => p.status === "changed").length;
    console.log(
      chalk.gray(
        `변화 있음: ${changed}, 변화 없음: ${unchanged}, 새로움: ${newProjects.length}, 제거됨: ${removedProjects.length}`,
      ),
    );
    console.log();
  });

// trends 커맨드
program
  .command("trends")
  .description("포트폴리오 트렌드 분석")
  .option("-n, --count <count>", "분석할 스캔 개수", "10")
  .action(async (options: { count: string }) => {
    const historyStore = new HistoryStore();
    const count = parseInt(options.count, 10) || 10;
    const results = await historyStore.loadRecent(count);

    if (results.length < 2) {
      console.log(chalk.gray("트렌드를 분석하려면 최소 2번의 스캔이 필요합니다."));
      console.log(chalk.gray(`현재 히스토리: ${results.length}개`));
      return;
    }

    const trend = TrendAnalyzer.buildTrend(results);
    // 오래된 순으로 정렬
    const orderedTrend = [...trend].reverse();

    console.log();
    console.log(chalk.cyan.bold("📈 포트폴리오 트렌드"));
    console.log(chalk.gray(`최근 ${results.length}개 스캔 기준`));
    console.log();

    // 평균 진행률 추이
    console.log(chalk.cyan("평균 진행률 추이"));
    const maxProgress = Math.max(
      ...orderedTrend.map((t) => t.avgProgress ?? 0),
      100,
    );
    orderedTrend.forEach((point) => {
      const value = point.avgProgress ?? 0;
      const barLen = Math.round((value / maxProgress) * 30);
      const bar = "█".repeat(barLen) + "░".repeat(30 - barLen);
      console.log(
        `  ${formatShortDateTime(point.scannedAt)} ${chalk.cyan(bar)} ${formatProgress(point.avgProgress)}`,
      );
    });
    console.log();

    // 준비도 추이
    console.log(chalk.cyan("포트폴리오 준비도 추이"));
    orderedTrend.forEach((point) => {
      const barLen = Math.round((point.avgReadiness / 100) * 30);
      const bar = "█".repeat(barLen) + "░".repeat(30 - barLen);
      console.log(
        `  ${formatShortDateTime(point.scannedAt)} ${chalk.green(bar)} ${point.avgReadiness}%`,
      );
    });
    console.log();

    // 활성 프로젝트 추이
    console.log(chalk.cyan("활성 프로젝트 수 추이"));
    const maxActive = Math.max(...orderedTrend.map((t) => t.active), 1);
    orderedTrend.forEach((point) => {
      const barLen = Math.round((point.active / maxActive) * 20);
      const bar = "█".repeat(barLen) + "░".repeat(20 - barLen);
      console.log(
        `  ${formatShortDateTime(point.scannedAt)} ${chalk.yellow(bar)} ${point.active}/${point.total}`,
      );
    });
    console.log();

    // 전체 변화 요약
    const oldest = orderedTrend[0];
    const newest = orderedTrend[orderedTrend.length - 1];
    console.log(chalk.cyan("전체 변화 (처음 → 마지막)"));
    if (oldest.avgProgress !== null && newest.avgProgress !== null) {
      console.log(
        `  평균 진행률: ${oldest.avgProgress}% → ${newest.avgProgress}% (${formatChange(newest.avgProgress - oldest.avgProgress, "%p")})`,
      );
    }
    console.log(
      `  준비도: ${oldest.avgReadiness}% → ${newest.avgReadiness}% (${formatChange(newest.avgReadiness - oldest.avgReadiness, "%p")})`,
    );
    console.log(
      `  활성 프로젝트: ${oldest.active} → ${newest.active} (${formatChange(newest.active - oldest.active, "")})`,
    );
    console.log();
  });

// config 커맨드
program
  .command("config")
  .description("설정 관리")
  .addCommand(
    new Command("add")
      .argument("<dir>")
      .description("프로젝트 디렉토리 추가")
      .action(async (dir) => {
        const configManager = new ConfigManager();
        const added = await configManager.addProjectDir(dir);
        if (added) {
          console.log(chalk.green(`✓ 디렉토리 추가됨: ${dir}`));
        } else {
          console.log(chalk.gray(`이미 등록된 디렉토리입니다: ${dir}`));
        }
      }),
  )
  .addCommand(
    new Command("remove")
      .alias("rm")
      .argument("<dir>")
      .description("프로젝트 디렉토리 제거")
      .action(async (dir) => {
        const configManager = new ConfigManager();
        const removed = await configManager.removeProjectDir(dir);
        if (removed) {
          console.log(chalk.green(`✓ 디렉토리 제거됨: ${dir}`));
        } else {
          console.log(chalk.gray(`등록되지 않은 디렉토리입니다: ${dir}`));
        }
      }),
  )
  .addCommand(
    new Command("list").description("현재 설정 보기").action(async () => {
      const configManager = new ConfigManager();
      const config = await configManager.getConfig();

      console.log(chalk.cyan("프로젝트 디렉토리:"));
      config.projectDirs.forEach((dir) => {
        console.log(chalk.gray(`  - ${dir}`));
      });
    }),
  );

function formatPriority(priority = "LOW"): string {
  if (priority === "CRITICAL") return chalk.red(priority);
  if (priority === "HIGH") return chalk.yellow(priority);
  if (priority === "MEDIUM") return chalk.blue(priority);
  return chalk.gray(priority);
}

function formatActivity(daysSinceLastCommit: number): string {
  if (daysSinceLastCommit === Number.MAX_SAFE_INTEGER) return "커밋 없음";
  if (daysSinceLastCommit === 0) return "오늘";
  return `${daysSinceLastCommit}일 전`;
}

function formatProgress(percentage: number | null): string {
  if (percentage === null) return "판단 불가";
  return `${percentage}%`;
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatShortDateTime(value: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatChange(value: number, suffix = ""): string {
  if (value === 0) return chalk.gray(`±0${suffix}`);
  if (value > 0) return chalk.green(`▲ +${value}${suffix}`);
  return chalk.red(`▼ ${value}${suffix}`);
}

async function loadScanResult(options: { refresh?: boolean }) {
  const configManager = new ConfigManager();
  const config = await configManager.load();
  const scanner = new Scanner(config);
  const store = new ScanStore();
  const cached = options.refresh ? null : await store.load();
  const result = cached ?? (await scanner.scan());

  if (!cached) {
    await store.save(result);
  }

  return {
    result,
    fromCache: Boolean(cached),
  };
}

type ExportFormat = "markdown" | "html" | "json";

function normalizeExportFormat(format: string): ExportFormat {
  const normalized = format.toLowerCase();
  if (normalized === "md" || normalized === "markdown") return "markdown";
  if (normalized === "html") return "html";
  if (normalized === "json") return "json";
  throw new Error(`지원하지 않는 export 형식입니다: ${format}`);
}

function defaultExportPath(format: ExportFormat): string {
  if (format === "html") return "portfolio-report.html";
  if (format === "json") return "portfolio-report.json";
  return "portfolio-report.md";
}

function renderExportContent(
  format: ExportFormat,
  result: Awaited<ReturnType<typeof loadScanResult>>["result"],
  options: { includeLowPriority?: boolean },
): string {
  if (format === "html") return renderHtmlReport(result, options);
  if (format === "json") return renderJsonReport(result, options);
  return renderMarkdownReport(result, options);
}

program.parse(process.argv);
