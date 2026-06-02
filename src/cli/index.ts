#!/usr/bin/env node

import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs/promises";
import http from "http";
import path from "path";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { ConfigManager } from "../config/ConfigManager.js";
import {
  KakaoNotifier,
  shouldNotifyKakao,
  type KakaoDiagnosticLevel,
} from "../core/KakaoNotifier.js";
import { formatDuration, parseDuration } from "../core/Interval.js";
import { LaunchAgent } from "../core/LaunchAgent.js";
import { resolveProgressChangeThreshold } from "../core/NotificationPolicy.js";
import { Scanner } from "../core/Scanner.js";
import {
  buildScanNotification,
  shouldNotifySubAgent,
  SubAgentClient,
} from "../core/SubAgentClient.js";
import { TrendAnalyzer } from "../core/TrendAnalyzer.js";
import { WebhookNotifier } from "../core/WebhookNotifier.js";
import type { Config, Project, ScanResult } from "../core/ProjectModel.js";
import type { ScanDiff } from "../core/TrendAnalyzer.js";
import { renderHtmlReport } from "../report/HtmlReport.js";
import { renderJsonReport } from "../report/JsonReport.js";
import { renderMarkdownReport } from "../report/MarkdownReport.js";
import { HistoryStore } from "../storage/HistoryStore.js";
import { ScanStore } from "../storage/ScanStore.js";

const program = new Command();
const execFileAsync = promisify(execFile);

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
    console.log(
      chalk.blue("  portfolio-tracker report --refresh # 스캔 & 리포트"),
    );
  });

// scan 커맨드 (구현 진행 중)
program
  .command("scan")
  .description("프로젝트 디렉토리 스캔")
  .option("--no-save", "스캔 결과를 파일로 저장하지 않음")
  .option("--incremental", "변경된 프로젝트만 재스캔 (캐시 없으면 전체 스캔)")
  .action(async (options: { save?: boolean; incremental?: boolean }) => {
    const configManager = new ConfigManager();
    const config = await configManager.load();
    const scanner = new Scanner(config);
    const store = new ScanStore();

    let result: ScanResult;
    let rescanned = 0;
    let reused = 0;

    if (options.incremental) {
      const lastResult = await store.load();
      if (lastResult) {
        const daysSince = Math.floor(
          (Date.now() - lastResult.scannedAt.getTime()) / 86_400_000,
        );
        console.log(
          chalk.blue(`🔍 증분 스캔 중... (마지막 스캔: ${daysSince}일 전)`),
        );
        ({ result, rescanned, reused } =
          await scanner.scanIncremental(lastResult));
      } else {
        console.log(
          chalk.yellow("⚠ 저장된 스캔 없음, 전체 스캔으로 진행합니다."),
        );
        console.log(chalk.blue("🔍 프로젝트 스캔 중..."));
        result = await scanner.scan();
      }
    } else {
      console.log(chalk.blue("🔍 프로젝트 스캔 중..."));
      result = await scanner.scan();
    }

    if (options.incremental && (rescanned > 0 || reused > 0)) {
      console.log(
        chalk.green(
          `✓ ${result.projects.length}개 프로젝트 (${rescanned}개 재스캔, ${reused}개 캐시)\n`,
        ),
      );
    } else {
      console.log(
        chalk.green(`✓ ${result.projects.length}개의 프로젝트를 찾았습니다!\n`),
      );
    }

    result.projects.forEach((project) => {
      console.log(chalk.cyan(project.name));
      console.log(`  경로: ${project.path}`);
      console.log(`  README: ${project.metadata.hasReadme ? "✓" : "✗"}`);
      console.log(`  CLAUDE.md: ${project.metadata.hasClaude ? "✓" : "✗"}`);
      console.log(`  Git: ${project.metadata.hasGit ? "✓" : "✗"}`);
      console.log(`  타입: ${project.type}`);
      console.log(`  진행률: ${formatProgress(project.progress.percentage)}`);
      console.log();
    });

    if (options.save !== false) {
      await store.save(result);
      console.log(chalk.gray(`스캔 결과 저장: ${store.path}`));
    }

    console.log(chalk.gray("다음 단계: portfolio-tracker report"));
  });

// watch 커맨드
program
  .command("watch")
  .description("설정된 주기로 프로젝트를 자동 스캔")
  .option("-i, --interval <duration>", "스캔 주기 (예: 30m, 2h, 1d)")
  .option("--no-initial", "시작 직후 스캔하지 않음")
  .option("--once", "한 번만 스캔하고 종료 (테스트/자동화용)")
  .action(
    async (options: {
      interval?: string;
      initial?: boolean;
      once?: boolean;
    }) => {
      const configManager = new ConfigManager();
      const config = await configManager.load();
      const intervalMs = options.interval
        ? parseDuration(options.interval)
        : (config.scanInterval ?? 24 * 60 * 60 * 1000);

      console.log(chalk.cyan("자동 스캔을 시작합니다."));
      console.log(chalk.gray(`  주기: ${formatDuration(intervalMs)}`));
      console.log(chalk.gray(`  저장 위치: ${new ScanStore().path}`));
      console.log(chalk.gray("  종료: Ctrl+C"));
      console.log();

      let running = false;
      const run = async () => {
        if (running) {
          console.log(
            chalk.gray(
              `[${formatDateTime(new Date())}] 이전 스캔이 아직 실행 중이라 건너뜁니다.`,
            ),
          );
          return;
        }

        running = true;
        try {
          const result = await runAndSaveScan();
          console.log(
            chalk.green(
              `[${formatDateTime(result.scannedAt)}] ${result.projects.length}개 프로젝트 스캔 완료`,
            ),
          );
          console.log(
            chalk.gray(
              `  평균 진행률: ${formatProgress(result.summary.avgProgress)}, 준비도: ${result.summary.avgReadiness}%`,
            ),
          );

          const diff = await loadLatestDiff();
          await notifyWebhookAfterScan(config, result, diff);
          await notifySubAgentAfterScan(config, result, diff);
          await notifyKakaoAfterScan(config, result, diff);
        } catch (error) {
          console.error(chalk.red("자동 스캔 실패:"), error);
        } finally {
          running = false;
        }
      };

      if (options.initial !== false || options.once) {
        await run();
      }

      if (options.once) {
        return;
      }

      const timer = setInterval(() => {
        void run();
      }, intervalMs);

      const stop = () => {
        clearInterval(timer);
        console.log();
        console.log(chalk.gray("자동 스캔을 종료합니다."));
        process.exit(0);
      };

      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    },
  );

// service 커맨드
const service = program
  .command("service")
  .description("macOS 로그인 자동 실행 서비스 관리");

service
  .command("install")
  .description("로그인 시 자동 스캔이 시작되도록 등록")
  .option("-i, --interval <duration>", "스캔 주기 (예: 30m, 2h, 1d)")
  .option("--no-initial", "서비스 시작 직후 스캔하지 않음")
  .option("--no-start", "등록만 하고 바로 시작하지 않음")
  .action(
    async (options: {
      interval?: string;
      initial?: boolean;
      start?: boolean;
    }) => {
      const intervalMs = options.interval
        ? parseDuration(options.interval)
        : undefined;
      const agent = new LaunchAgent();

      await agent.install({
        nodePath: await resolveNodePath(),
        cliPath: fileURLToPath(import.meta.url),
        workingDirectory: process.cwd(),
        interval: options.interval,
        initial: options.initial,
      });

      if (options.start !== false) {
        await agent.start();
      }

      console.log(chalk.green("✓ 자동 실행 서비스가 등록되었습니다."));
      console.log(chalk.gray(`  Label: ${agent.label}`));
      console.log(chalk.gray(`  Plist: ${agent.paths.plistPath}`));
      console.log(chalk.gray(`  Log: ${agent.paths.logPath}`));
      console.log(
        chalk.gray(
          `  주기: ${intervalMs ? formatDuration(intervalMs) : "config.json scanInterval"}`,
        ),
      );
      console.log();
      console.log(chalk.blue("끄기: portfolio-tracker service stop"));
      console.log(
        chalk.blue("자동 실행 제거: portfolio-tracker service uninstall"),
      );
    },
  );

service
  .command("start")
  .description("등록된 자동 스캔 서비스를 시작")
  .action(async () => {
    const agent = new LaunchAgent();
    if (!(await agent.isInstalled())) {
      console.log(
        chalk.yellow(
          "등록된 서비스가 없습니다. 먼저 service install을 실행하세요.",
        ),
      );
      return;
    }

    await agent.start();
    console.log(chalk.green("✓ 자동 스캔 서비스를 시작했습니다."));
  });

service
  .command("stop")
  .description("현재 실행 중인 자동 스캔 서비스를 중지")
  .action(async () => {
    const agent = new LaunchAgent();
    const running = await agent.isRunning().catch(() => false);
    if (!running) {
      console.log(chalk.gray("실행 중인 서비스가 없습니다."));
      return;
    }
    await agent.stop({ ignoreErrors: true });
    console.log(chalk.green("✓ 자동 스캔 서비스를 중지했습니다."));
    console.log(chalk.gray("다음 로그인 때는 다시 시작됩니다."));
    console.log(
      chalk.gray("자동 실행까지 끄려면 service uninstall을 실행하세요."),
    );
  });

service
  .command("restart")
  .description("자동 스캔 서비스를 재시작")
  .action(async () => {
    const agent = new LaunchAgent();
    if (!(await agent.isInstalled())) {
      console.log(
        chalk.yellow(
          "등록된 서비스가 없습니다. 먼저 service install을 실행하세요.",
        ),
      );
      return;
    }

    await agent.start();
    console.log(chalk.green("✓ 자동 스캔 서비스를 재시작했습니다."));
  });

service
  .command("uninstall")
  .description("자동 스캔 서비스를 중지하고 로그인 자동 실행 등록을 제거")
  .action(async () => {
    const agent = new LaunchAgent();
    await agent.uninstall();
    console.log(chalk.green("✓ 자동 실행 서비스가 제거되었습니다."));
  });

service
  .command("status")
  .description("자동 스캔 서비스 상태 확인")
  .action(async () => {
    const agent = new LaunchAgent();
    const [installed, running] = await Promise.all([
      agent.isInstalled(),
      agent.isRunning(),
    ]);

    console.log(chalk.cyan("자동 스캔 서비스 상태"));
    console.log(`  등록됨: ${installed ? "✓" : "✗"}`);
    console.log(`  실행 중: ${running ? "✓" : "✗"}`);
    console.log(chalk.gray(`  Plist: ${agent.paths.plistPath}`));
    console.log(chalk.gray(`  Log: ${agent.paths.logPath}`));
  });

service
  .command("logs")
  .description("자동 스캔 서비스 로그 확인")
  .option("-n, --lines <count>", "출력할 마지막 줄 수", "80")
  .option("--error", "에러 로그 확인")
  .action(async (options: { lines?: string; error?: boolean }) => {
    const agent = new LaunchAgent();
    const logPath = options.error
      ? agent.paths.errorLogPath
      : agent.paths.logPath;
    const lines = Number.parseInt(options.lines ?? "80", 10);
    const content = await readLastLines(
      logPath,
      Number.isFinite(lines) ? lines : 80,
    );

    console.log(chalk.gray(logPath));
    console.log(content || chalk.gray("(로그 없음)"));
  });

// agent 커맨드
const agent = program
  .command("agent")
  .description("local-mac-sub-agent 연결 관리");

agent
  .command("status")
  .description("sub-agent 연결 상태 확인")
  .action(async () => {
    const config = await new ConfigManager().load();
    const client = SubAgentClient.fromConfig(config.subAgent);

    if (!client) {
      console.log(chalk.yellow("sub-agent 연결이 비활성화되어 있습니다."));
      console.log(
        chalk.gray("config.json의 subAgent.enabled를 true로 설정하세요."),
      );
      return;
    }

    const health = await client.health();
    console.log(chalk.green("✓ sub-agent 연결됨"));
    console.log(JSON.stringify(health, null, 2));
  });

agent
  .command("test")
  .description("sub-agent로 테스트 알림 전송")
  .action(async () => {
    const client = await requireSubAgentClient();
    const task = await client.notify(
      "Portfolio Tracker",
      "sub-agent 연결 테스트가 완료되었습니다.",
    );

    console.log(chalk.green(`✓ 테스트 알림 전송 완료 (${task.id})`));
  });

agent
  .command("open-report")
  .description("HTML 리포트를 생성하고 sub-agent로 열기")
  .option("-o, --output <file>", "출력 파일", "portfolio-report.html")
  .option("-r, --refresh", "저장된 결과 대신 새로 스캔")
  .option("--incremental", "변경된 프로젝트만 재스캔")
  .option("-a, --all", "LOW 우선순위 프로젝트까지 모두 포함")
  .action(
    async (options: {
      output: string;
      refresh?: boolean;
      incremental?: boolean;
      all?: boolean;
    }) => {
      const client = await requireSubAgentClient();
      const { result, fromCache } = await loadScanResult({
        refresh: options.refresh,
        incremental: options.incremental,
      });
      const outputPath = path.resolve(process.cwd(), options.output);
      const content = renderHtmlReport(result, {
        includeLowPriority: options.all,
      });

      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, content, "utf-8");
      const task = await client.openFile(outputPath);

      console.log(chalk.green(`✓ HTML 리포트 열기 요청 완료 (${task.id})`));
      console.log(chalk.gray(`  파일: ${outputPath}`));
      console.log(
        chalk.gray(`  데이터: ${fromCache ? "저장된 결과" : "새 스캔 결과"}`),
      );
    },
  );

// kakao 커맨드
const kakao = program
  .command("kakao")
  .description("카카오톡 나에게 보내기 연동");

kakao
  .command("auth")
  .description("Kakao Login으로 talk_message 토큰 저장")
  .option("--rest-api-key <key>", "Kakao Developers REST API 키")
  .option("--client-secret <secret>", "Kakao Login client secret")
  .option("--redirect-uri <uri>", "등록된 Redirect URI")
  .option("--code <code>", "이미 받은 authorization code로 토큰 발급")
  .option("--no-open", "인증 URL을 브라우저로 자동 열지 않음")
  .action(
    async (options: {
      restApiKey?: string;
      clientSecret?: string;
      redirectUri?: string;
      code?: string;
      open?: boolean;
    }) => {
      const config = await new ConfigManager().load();
      const notifier = KakaoNotifier.configured({
        ...config.kakao,
        restApiKey: options.restApiKey ?? config.kakao?.restApiKey,
        clientSecret: options.clientSecret ?? config.kakao?.clientSecret,
        redirectUri: options.redirectUri ?? config.kakao?.redirectUri,
      });

      if (options.code) {
        await notifier.exchangeCode(options.code);
      } else {
        const state = crypto.randomBytes(16).toString("hex");
        const authUrl = notifier.getAuthorizationUrl(state);
        const codePromise = waitForKakaoAuthCode(notifier.redirectUri, state);

        console.log(chalk.cyan("아래 URL에서 카카오 로그인을 승인하세요."));
        console.log(authUrl);
        console.log();
        console.log(
          chalk.gray(
            `Redirect URI: ${notifier.redirectUri} (Kakao Developers에 등록되어 있어야 합니다.)`,
          ),
        );

        if (options.open !== false) {
          await openBrowser(authUrl).catch((error) => {
            console.log(
              chalk.yellow(
                `브라우저 자동 열기 실패: ${error instanceof Error ? error.message : error}`,
              ),
            );
          });
        }

        await notifier.exchangeCode(await codePromise);
      }

      console.log(chalk.green("✓ 카카오 토큰 저장 완료"));
      console.log(chalk.gray(`  Token: ${notifier.tokenFile}`));
    },
  );

kakao
  .command("status")
  .description("카카오 연동 설정과 토큰 상태 확인")
  .action(async () => {
    const config = await new ConfigManager().load();
    const notifier = KakaoNotifier.configured(config.kakao);
    const status = await notifier.status();

    console.log(chalk.cyan("카카오 연동 상태"));
    console.log(`  활성화: ${config.kakao?.enabled ? "✓" : "✗"}`);
    console.log(`  REST API 키: ${status.configured ? "✓" : "✗"}`);
    console.log(`  토큰: ${status.hasToken ? "✓" : "✗"}`);
    console.log(
      `  talk_message 권한: ${formatScopeStatus(status.hasTalkMessageScope)}`,
    );
    console.log(`  Link URL: ${status.linkUrl}`);
    if (status.linkUrlOrigin) {
      console.log(chalk.gray(`  Web domain 후보: ${status.linkUrlOrigin}`));
    }
    console.log(chalk.gray(`  Token: ${status.tokenFile}`));
    if (status.accessTokenExpiresAt) {
      console.log(
        chalk.gray(`  Access token 만료: ${status.accessTokenExpiresAt}`),
      );
    }
    if (status.refreshTokenExpiresAt) {
      console.log(
        chalk.gray(`  Refresh token 만료: ${status.refreshTokenExpiresAt}`),
      );
    }
    if (status.scope) {
      console.log(chalk.gray(`  Scope: ${status.scope}`));
    }
    if (status.diagnostics.length > 0) {
      console.log();
      console.log(chalk.cyan("진단"));
      status.diagnostics.forEach((diagnostic) => {
        console.log(
          formatKakaoDiagnostic(diagnostic.level, diagnostic.message),
        );
        if (diagnostic.action) {
          console.log(chalk.gray(`    조치: ${diagnostic.action}`));
        }
      });
    }
  });

kakao
  .command("test")
  .description("카카오톡 나에게 테스트 메시지 전송")
  .action(async () => {
    const notifier = await requireKakaoNotifier();
    await notifier.sendTextToMe(
      "[Portfolio Tracker]\n카카오톡 나에게 보내기 연동 테스트입니다.",
    );

    console.log(chalk.green("✓ 카카오톡 나에게 테스트 메시지 전송 완료"));
  });

// report 커맨드
program
  .command("report")
  .description("프로젝트 진행 리포트 출력")
  .option("-a, --all", "LOW 우선순위 프로젝트까지 모두 표시")
  .option("-r, --refresh", "저장된 결과 대신 새로 스캔")
  .option("--incremental", "변경된 프로젝트만 재스캔 (--refresh 없이도 동작)")
  .option("--threads", "프로젝트별 활성 thread 상세 표시 (ThreadKeeper)")
  .action(
    async (options: {
      all?: boolean;
      refresh?: boolean;
      incremental?: boolean;
      threads?: boolean;
    }) => {
      console.log(chalk.blue("프로젝트 리포트 생성 중..."));
      const { result, fromCache } = await loadScanResult({
        refresh: options.refresh,
        incremental: options.incremental,
      });
      const projects = options.all
        ? result.projects
        : result.projects.filter((project) => project.priority !== "LOW");

      console.log();
      console.log(chalk.cyan("요약"));
      console.log(`  전체 프로젝트: ${result.summary.total}`);
      console.log(`  최근 활성: ${result.summary.active}`);
      console.log(
        `  평균 진행률: ${formatProgress(result.summary.avgProgress)}`,
      );
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
        head: [
          "우선순위",
          "프로젝트",
          "타입",
          "진행률",
          "준비도",
          "최근 활동",
          "이슈",
        ],
        wordWrap: true,
        colWidths: [12, 24, 12, 10, 20, 16, 30],
      });

      projects.forEach((project) => {
        table.push([
          formatPriority(project.priority),
          project.name,
          project.type,
          formatProgress(project.progress.percentage),
          formatReadinessCellConsole(project),
          formatActivity(project.activity.daysSinceLastCommit),
          project.issues?.join(", ") || "-",
        ]);
      });

      console.log(table.toString());

      if (options.threads) {
        console.log();
        console.log(chalk.cyan("ThreadKeeper 스레드 상세"));
        for (const project of projects) {
          const c = project.continuity;
          if (!c || !c.summary || c.summary.total === 0) continue;
          const badge =
            c.coverage === "live"
              ? "live"
              : c.coverage === "stale"
                ? `stale ${c.ageDays ?? "?"}d`
                : "offline";
          console.log(
            chalk.bold(`\n${project.name}`) +
              chalk.gray(` [${badge}] 활성 ${c.summary.active} / 전체 ${c.summary.total}`),
          );
          if (c.summary.activeThreads.length === 0) {
            console.log(chalk.gray("  활성 thread 없음"));
          }
          for (const t of c.summary.activeThreads) {
            const next = t.currentNextAction ? ` → ${t.currentNextAction}` : "";
            console.log(`  - [${t.priority}] ${t.title}${next}`);
          }
        }
      }

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
    },
  );

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
  .option("--incremental", "변경된 프로젝트만 재스캔 (--refresh 없이도 동작)")
  .action(
    async (options: {
      format: string;
      output?: string;
      all?: boolean;
      refresh?: boolean;
      incremental?: boolean;
    }) => {
      const { result, fromCache } = await loadScanResult({
        refresh: options.refresh,
        incremental: options.incremental,
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
      console.log(chalk.red(`✗ 프로젝트를 찾을 수 없습니다: ${projectName}`));
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
      `  우선순위: ${chalk.bold(formatPriority(project.priority ?? "LOW"))}`,
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
    console.log(
      `  포트폴리오 준비도: ${chalk.bold(`${result.summary.avgReadiness}%`)}`,
    );
    console.log();

    // 우선순위별 분포
    console.log(chalk.cyan("우선순위별"));
    const priorityTable = new Table({
      head: ["우선순위", "프로젝트 수", "비율"],
      colWidths: [12, 14, 10],
    });
    (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).forEach((priority) => {
      const count = result.summary.byPriority[priority];
      const ratio = Math.round(
        (count / Math.max(result.summary.total, 1)) * 100,
      );
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
        const ratio = Math.round(
          (count / Math.max(result.summary.total, 1)) * 100,
        );
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
        check: (p: (typeof projects)[0]) => p.activity.daysSinceLastCommit <= 7,
      },
      {
        label: "최근 (8-30일)",
        check: (p: (typeof projects)[0]) =>
          p.activity.daysSinceLastCommit > 7 &&
          p.activity.daysSinceLastCommit <= 30,
      },
      {
        label: "오래됨 (31-90일)",
        check: (p: (typeof projects)[0]) =>
          p.activity.daysSinceLastCommit > 30 &&
          p.activity.daysSinceLastCommit <= 90,
      },
      {
        label: "잊혀짐 (90일+)",
        check: (p: (typeof projects)[0]) =>
          p.activity.daysSinceLastCommit > 90 &&
          p.activity.daysSinceLastCommit < Number.MAX_SAFE_INTEGER,
      },
      {
        label: "Git 없음",
        check: (p: (typeof projects)[0]) =>
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
  .action(
    async (projectName: string | undefined, options: { count: string }) => {
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
            chalk.red(
              `✗ 히스토리에서 프로젝트를 찾을 수 없습니다: ${projectName}`,
            ),
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
            console.log(`  진행률: ${formatChange(progressChange, "%p")}`);
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
          chalk.gray(
            `총 ${results.length}개의 스캔 기록 (저장 위치: ${historyStore.dir})`,
          ),
        );
        console.log();
      }
    },
  );

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
      console.log(
        chalk.cyan(`💀 사라진 프로젝트 (${removedProjects.length}개)`),
      );
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
    const unchanged = diff.projects.filter(
      (p) => p.status === "unchanged",
    ).length;
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
      console.log(
        chalk.gray("트렌드를 분석하려면 최소 2번의 스캔이 필요합니다."),
      );
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
      console.log();
      console.log(chalk.cyan("sub-agent 연동:"));
      console.log(`  활성화: ${config.subAgent?.enabled ? "✓" : "✗"}`);
      if (config.subAgent?.baseUrl) {
        console.log(chalk.gray(`  Base URL: ${config.subAgent.baseUrl}`));
      }
      if (config.subAgent?.tokenFile) {
        console.log(chalk.gray(`  Token: ${config.subAgent.tokenFile}`));
      } else if (config.subAgent?.token) {
        console.log(chalk.gray("  Token: 직접 설정됨"));
      }
      console.log();
      console.log(chalk.cyan("알림 정책:"));
      console.log(
        `  진행률 변화 기준: ${resolveProgressChangeThreshold(config.notification)}%p`,
      );
      console.log();
      console.log(chalk.cyan("카카오 연동:"));
      console.log(`  활성화: ${config.kakao?.enabled ? "✓" : "✗"}`);
      console.log(`  REST API 키: ${config.kakao?.restApiKey ? "✓" : "✗"}`);
      if (config.kakao?.redirectUri) {
        console.log(chalk.gray(`  Redirect URI: ${config.kakao.redirectUri}`));
      }
      if (config.kakao?.tokenFile) {
        console.log(chalk.gray(`  Token: ${config.kakao.tokenFile}`));
      }
    }),
  )
  .addCommand(
    new Command("notifications")
      .alias("notification")
      .description("공통 알림 정책 설정")
      .option("--progress-threshold <percent>", "진행률 변화 알림 기준(%p)")
      .action(async (options: { progressThreshold?: string }) => {
        const configManager = new ConfigManager();
        const config = await configManager.load();
        config.notification = {
          ...config.notification,
        };

        if (options.progressThreshold !== undefined) {
          config.notification.progressChangeThreshold = parseNumberOption(
            options.progressThreshold,
            "--progress-threshold",
          );
          await configManager.save(config);
          console.log(chalk.green("✓ 알림 정책 저장 완료"));
        }

        console.log(
          chalk.gray(
            `  진행률 변화 기준: ${resolveProgressChangeThreshold(config.notification)}%p`,
          ),
        );
      }),
  )
  .addCommand(
    new Command("agent")
      .description("local-mac-sub-agent 설정")
      .option("--enable", "sub-agent 연동 활성화")
      .option("--disable", "sub-agent 연동 비활성화")
      .option("--base-url <url>", "sub-agent API Base URL")
      .option("--token <token>", "Bearer 토큰 직접 저장")
      .option("--token-file <file>", "Bearer 토큰 파일")
      .option("--notify-on-scan <value>", "매 스캔마다 알림 true/false")
      .option("--notify-on-changes <value>", "변화 있을 때 알림 true/false")
      .option(
        "--open-report-on-changes <value>",
        "변화 있을 때 HTML 리포트 열기 true/false",
      )
      .action(
        async (options: {
          enable?: boolean;
          disable?: boolean;
          baseUrl?: string;
          token?: string;
          tokenFile?: string;
          notifyOnScan?: string;
          notifyOnChanges?: string;
          openReportOnChanges?: string;
        }) => {
          if (options.enable && options.disable) {
            throw new Error("--enable과 --disable은 같이 사용할 수 없습니다.");
          }

          const configManager = new ConfigManager();
          const config = await configManager.load();
          config.subAgent = {
            enabled: false,
            baseUrl: "http://127.0.0.1:4877",
            notifyOnScan: true,
            notifyOnChanges: true,
            openReportOnChanges: false,
            ...config.subAgent,
          };

          if (options.enable) config.subAgent.enabled = true;
          if (options.disable) config.subAgent.enabled = false;
          if (options.baseUrl !== undefined) {
            config.subAgent.baseUrl = options.baseUrl;
          }
          if (options.token !== undefined) {
            config.subAgent.token = options.token;
          }
          if (options.tokenFile !== undefined) {
            config.subAgent.tokenFile = options.tokenFile;
          }
          if (options.notifyOnScan !== undefined) {
            config.subAgent.notifyOnScan = parseBooleanOption(
              options.notifyOnScan,
              "--notify-on-scan",
            );
          }
          if (options.notifyOnChanges !== undefined) {
            config.subAgent.notifyOnChanges = parseBooleanOption(
              options.notifyOnChanges,
              "--notify-on-changes",
            );
          }
          if (options.openReportOnChanges !== undefined) {
            config.subAgent.openReportOnChanges = parseBooleanOption(
              options.openReportOnChanges,
              "--open-report-on-changes",
            );
          }

          await configManager.save(config);

          console.log(chalk.green("✓ sub-agent 설정 저장 완료"));
          console.log(`  활성화: ${config.subAgent.enabled ? "✓" : "✗"}`);
          console.log(chalk.gray(`  Base URL: ${config.subAgent.baseUrl}`));
          if (config.subAgent.tokenFile) {
            console.log(chalk.gray(`  Token: ${config.subAgent.tokenFile}`));
          } else if (config.subAgent.token) {
            console.log(chalk.gray("  Token: 직접 설정됨"));
          }
        },
      ),
  )
  .addCommand(
    new Command("kakao")
      .description("카카오톡 나에게 보내기 설정")
      .option("--enable", "카카오 연동 활성화")
      .option("--disable", "카카오 연동 비활성화")
      .option("--rest-api-key <key>", "Kakao Developers REST API 키")
      .option("--client-secret <secret>", "Kakao Login client secret")
      .option("--redirect-uri <uri>", "Kakao Login Redirect URI")
      .option("--token-file <file>", "토큰 저장 파일")
      .option("--link-url <url>", "카톡 메시지 버튼 링크 URL")
      .option("--notify-on-scan <value>", "매 스캔마다 알림 true/false")
      .option("--notify-on-changes <value>", "변화 있을 때 알림 true/false")
      .action(
        async (options: {
          enable?: boolean;
          disable?: boolean;
          restApiKey?: string;
          clientSecret?: string;
          redirectUri?: string;
          tokenFile?: string;
          linkUrl?: string;
          notifyOnScan?: string;
          notifyOnChanges?: string;
        }) => {
          if (options.enable && options.disable) {
            throw new Error("--enable과 --disable은 같이 사용할 수 없습니다.");
          }

          const configManager = new ConfigManager();
          const config = await configManager.load();
          config.kakao = {
            enabled: false,
            redirectUri: "http://localhost:4888/kakao/callback",
            tokenFile: ".portfolio-tracker/kakao-token.json",
            linkUrl: "https://developers.kakao.com",
            notifyOnScan: true,
            notifyOnChanges: true,
            ...config.kakao,
          };

          if (options.enable) config.kakao.enabled = true;
          if (options.disable) config.kakao.enabled = false;
          if (options.restApiKey !== undefined) {
            config.kakao.restApiKey = options.restApiKey;
          }
          if (options.clientSecret !== undefined) {
            config.kakao.clientSecret = options.clientSecret;
          }
          if (options.redirectUri !== undefined) {
            config.kakao.redirectUri = options.redirectUri;
          }
          if (options.tokenFile !== undefined) {
            config.kakao.tokenFile = options.tokenFile;
          }
          if (options.linkUrl !== undefined) {
            config.kakao.linkUrl = options.linkUrl;
          }
          if (options.notifyOnScan !== undefined) {
            config.kakao.notifyOnScan = parseBooleanOption(
              options.notifyOnScan,
              "--notify-on-scan",
            );
          }
          if (options.notifyOnChanges !== undefined) {
            config.kakao.notifyOnChanges = parseBooleanOption(
              options.notifyOnChanges,
              "--notify-on-changes",
            );
          }

          await configManager.save(config);

          console.log(chalk.green("✓ 카카오 설정 저장 완료"));
          console.log(`  활성화: ${config.kakao.enabled ? "✓" : "✗"}`);
          console.log(`  REST API 키: ${config.kakao.restApiKey ? "✓" : "✗"}`);
          console.log(
            chalk.gray(`  Redirect URI: ${config.kakao.redirectUri}`),
          );
          console.log(chalk.gray(`  Token: ${config.kakao.tokenFile}`));
        },
      ),
  );

// threadkeeper 커맨드
program
  .command("threadkeeper")
  .description("ThreadKeeper 연동 설정")
  .option("--enable", "ThreadKeeper 연동 켜기")
  .option("--disable", "ThreadKeeper 연동 끄기")
  .option("--url <url>", "ThreadKeeper base URL (예: http://localhost:8080)")
  .option("--timeout <ms>", "요청 타임아웃 (ms)")
  .option("--stale-days <days>", "캐시 유효 최대 일수")
  .action(
    async (options: {
      enable?: boolean;
      disable?: boolean;
      url?: string;
      timeout?: string;
      staleDays?: string;
    }) => {
      const configManager = new ConfigManager();
      const config = await configManager.load();
      const tk = { ...(config.threadKeeper ?? {}) };

      if (options.enable) tk.enabled = true;
      if (options.disable) tk.enabled = false;
      if (options.url) tk.baseUrl = options.url;
      if (options.timeout) tk.timeoutMs = Number(options.timeout);
      if (options.staleDays) tk.staleMaxDays = Number(options.staleDays);

      config.threadKeeper = tk;
      await configManager.save(config);

      console.log(chalk.green("ThreadKeeper 설정이 저장되었습니다."));
      console.log(`  enabled: ${tk.enabled ?? false}`);
      console.log(`  baseUrl: ${tk.baseUrl ?? "http://localhost:8080"}`);
      console.log(`  timeoutMs: ${tk.timeoutMs ?? 2000}`);
      console.log(`  staleMaxDays: ${tk.staleMaxDays ?? 14}`);
    },
  );

function formatPriority(priority = "LOW"): string {
  if (priority === "CRITICAL") return chalk.red(priority);
  if (priority === "HIGH") return chalk.yellow(priority);
  if (priority === "MEDIUM") return chalk.blue(priority);
  return chalk.gray(priority);
}

function formatReadinessCellConsole(project: Project): string {
  const c = project.continuity;
  if (!c || c.coverage === "unavailable") return `${project.readiness}%`;
  const badge = c.coverage === "live" ? "live" : `stale ${c.ageDays ?? "?"}d`;
  return `${project.readiness}% (${project.baseReadiness}+${c.threadAdjustment}, ${badge})`;
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

function formatScopeStatus(hasTalkMessageScope: boolean | null): string {
  if (hasTalkMessageScope === true) return "✓";
  if (hasTalkMessageScope === false) return "✗";
  return "?";
}

function formatKakaoDiagnostic(
  level: KakaoDiagnosticLevel,
  message: string,
): string {
  const prefix =
    level === "error" ? "[error]" : level === "warning" ? "[warn]" : "[info]";
  const line = `  ${prefix} ${message}`;
  if (level === "error") return chalk.red(line);
  if (level === "warning") return chalk.yellow(line);
  return chalk.gray(line);
}

function parseBooleanOption(value: string, label: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  throw new Error(`${label} 값은 true 또는 false여야 합니다.`);
}

function parseNumberOption(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} 값은 0 이상의 숫자여야 합니다.`);
  }
  return parsed;
}

async function requireSubAgentClient(): Promise<SubAgentClient> {
  const config = await new ConfigManager().load();
  const client = SubAgentClient.fromConfig(config.subAgent);

  if (!client) {
    throw new Error(
      "sub-agent 연결이 비활성화되어 있습니다. config.json의 subAgent.enabled를 true로 설정하세요.",
    );
  }

  return client;
}

async function requireKakaoNotifier(): Promise<KakaoNotifier> {
  const config = await new ConfigManager().load();
  const notifier = KakaoNotifier.configured(config.kakao);
  const status = await notifier.status();

  if (!status.configured) {
    throw new Error(
      "카카오 REST API 키가 필요합니다. config.json의 kakao.restApiKey 또는 KAKAO_REST_API_KEY를 설정하세요.",
    );
  }
  if (!status.hasToken) {
    throw new Error("카카오 토큰이 없습니다. 먼저 kakao auth를 실행하세요.");
  }

  return notifier;
}

function waitForKakaoAuthCode(
  redirectUri: string,
  expectedState: string,
): Promise<string> {
  const redirect = new URL(redirectUri);
  const allowedHosts = new Set(["localhost", "127.0.0.1"]);

  if (redirect.protocol !== "http:" || !allowedHosts.has(redirect.hostname)) {
    throw new Error(
      "자동 인증은 http://localhost 또는 http://127.0.0.1 Redirect URI만 지원합니다. 다른 URI는 --code 옵션을 사용하세요.",
    );
  }

  const port = Number.parseInt(redirect.port || "80", 10);

  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", redirectUri);

      if (requestUrl.pathname !== redirect.pathname) {
        response.writeHead(404, {
          "content-type": "text/plain; charset=utf-8",
        });
        response.end("Not found");
        return;
      }

      const error = requestUrl.searchParams.get("error");
      const errorDescription = requestUrl.searchParams.get("error_description");
      const state = requestUrl.searchParams.get("state");
      const code = requestUrl.searchParams.get("code");

      if (error) {
        response.writeHead(400, {
          "content-type": "text/plain; charset=utf-8",
        });
        response.end("Kakao authorization failed. You can close this window.");
        cleanup();
        reject(new Error(errorDescription ?? error));
        return;
      }

      if (state !== expectedState) {
        response.writeHead(400, {
          "content-type": "text/plain; charset=utf-8",
        });
        response.end("Invalid state. You can close this window.");
        cleanup();
        reject(new Error("카카오 인증 state 값이 일치하지 않습니다."));
        return;
      }

      if (!code) {
        response.writeHead(400, {
          "content-type": "text/plain; charset=utf-8",
        });
        response.end("Missing authorization code. You can close this window.");
        cleanup();
        reject(new Error("카카오 authorization code가 없습니다."));
        return;
      }

      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("Kakao authorization complete. You can close this window.");
      cleanup();
      resolve(code);
    });

    const timeout = setTimeout(
      () => {
        cleanup();
        reject(new Error("카카오 인증 대기 시간이 초과되었습니다."));
      },
      5 * 60 * 1000,
    );

    const cleanup = () => {
      clearTimeout(timeout);
      server.close();
    };

    server.on("error", (error) => {
      cleanup();
      reject(error);
    });
    server.listen(port, redirect.hostname);
  });
}

async function openBrowser(url: string): Promise<void> {
  if (process.platform === "darwin") {
    await execFileAsync("open", [url]);
    return;
  }

  console.log(chalk.gray("브라우저에서 직접 URL을 여세요."));
}

async function loadLatestDiff(): Promise<ScanDiff | null> {
  const historyStore = new HistoryStore();
  const recentResults = await historyStore.loadRecent(2);

  if (recentResults.length < 2) {
    return null;
  }

  return TrendAnalyzer.diff(recentResults[1], recentResults[0]);
}

async function notifyWebhookAfterScan(
  config: Config,
  result: ScanResult,
  diff: ScanDiff | null,
): Promise<void> {
  if (!config.webhookUrl) {
    return;
  }

  try {
    if (!diff) {
      console.log(chalk.gray("  [webhook] 히스토리 부족 – 다음 스캔부터 알림"));
      return;
    }

    const notificationOptions = config.notification ?? {};
    if (WebhookNotifier.shouldNotify(diff, notificationOptions)) {
      const notifier = new WebhookNotifier(config.webhookUrl);
      await notifier.notify(
        WebhookNotifier.buildPayload(diff, result, notificationOptions),
      );
      console.log(chalk.gray("  [webhook] 변경 알림 전송 완료"));
    }
  } catch (webhookError) {
    console.warn(
      chalk.yellow(
        `⚠ Webhook 전송 실패: ${
          webhookError instanceof Error ? webhookError.message : webhookError
        }`,
      ),
    );
  }
}

async function notifySubAgentAfterScan(
  config: Config,
  result: ScanResult,
  diff: ScanDiff | null,
): Promise<void> {
  const client = SubAgentClient.fromConfig(config.subAgent);
  const notificationOptions = config.notification ?? {};
  if (
    !client ||
    !shouldNotifySubAgent(config.subAgent, diff, notificationOptions)
  ) {
    return;
  }

  try {
    const notification = buildScanNotification(
      result,
      diff,
      notificationOptions,
    );
    await client.notify(notification.title, notification.message);
    console.log(chalk.gray("  [sub-agent] macOS 알림 전송 완료"));

    const shouldOpenReport =
      config.subAgent?.openReportOnChanges === true &&
      shouldNotifySubAgent(
        {
          ...config.subAgent,
          notifyOnScan: false,
          notifyOnChanges: true,
        },
        diff,
        notificationOptions,
      );

    if (shouldOpenReport) {
      const reportPath = path.resolve(process.cwd(), "portfolio-report.html");
      await fs.writeFile(
        reportPath,
        renderHtmlReport(result, { includeLowPriority: true }),
        "utf-8",
      );
      await client.openFile(reportPath);
      console.log(chalk.gray("  [sub-agent] HTML 리포트 열기 요청 완료"));
    }
  } catch (subAgentError) {
    console.warn(
      chalk.yellow(
        `⚠ sub-agent 전송 실패: ${
          subAgentError instanceof Error ? subAgentError.message : subAgentError
        }`,
      ),
    );
  }
}

async function notifyKakaoAfterScan(
  config: Config,
  result: ScanResult,
  diff: ScanDiff | null,
): Promise<void> {
  const notifier = KakaoNotifier.fromConfig(config.kakao);
  const notificationOptions = config.notification ?? {};
  if (
    !notifier ||
    !shouldNotifyKakao(config.kakao, diff, notificationOptions)
  ) {
    return;
  }

  try {
    await notifier.sendPortfolioSummary(result, diff, notificationOptions);
    console.log(chalk.gray("  [kakao] 나에게 메시지 전송 완료"));
  } catch (kakaoError) {
    console.warn(
      chalk.yellow(
        `⚠ 카카오 전송 실패: ${
          kakaoError instanceof Error ? kakaoError.message : kakaoError
        }`,
      ),
    );
  }
}

async function loadScanResult(options: {
  refresh?: boolean;
  incremental?: boolean;
}) {
  const configManager = new ConfigManager();
  const config = await configManager.load();
  const scanner = new Scanner(config);
  const store = new ScanStore();

  // refresh 없음 (그리고 incremental도 없음): 캐시 그대로 사용
  if (!options.refresh && !options.incremental) {
    const cached = await store.load();
    if (cached) return { result: cached, fromCache: true };
  }

  // 증분 스캔: 마지막 결과를 베이스로 사용
  if (options.incremental) {
    const lastResult = await store.load();
    if (lastResult) {
      const { result } = await scanner.scanIncremental(lastResult);
      await store.save(result);
      return { result, fromCache: false };
    }
    console.log(chalk.yellow("⚠ 저장된 스캔 없음, 전체 스캔으로 진행합니다."));
  }

  // 전체 스캔 (기본)
  const result = await scanner.scan();
  await store.save(result);
  return { result, fromCache: false };
}

async function runAndSaveScan() {
  const configManager = new ConfigManager();
  const config = await configManager.load();
  const scanner = new Scanner(config);
  const store = new ScanStore();
  const result = await scanner.scan();
  await store.save(result);
  return result;
}

async function readLastLines(filePath: string, count: number): Promise<string> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content.split(/\r?\n/).slice(-count).join("\n").trim();
  } catch {
    return "";
  }
}

async function resolveNodePath(): Promise<string> {
  const stableNodePaths = ["/opt/homebrew/bin/node", "/usr/local/bin/node"];

  for (const nodePath of stableNodePaths) {
    try {
      await fs.access(nodePath);
      return nodePath;
    } catch {
      // 다음 후보를 확인합니다.
    }
  }

  return process.execPath;
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
