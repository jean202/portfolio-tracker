# Incremental Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `portfolio-tracker scan --incremental` 플래그를 추가해 마지막 스캔 이후 변경된 프로젝트만 재분석하고, 변경 없는 프로젝트는 캐시를 재사용한다.

**Architecture:** `Scanner` 클래스에 `isProjectChanged(candidate, lastScannedAt)` 와 `scanIncremental(lastResult)` 두 메서드를 추가한다. git이 있는 프로젝트는 마지막 커밋 날짜로, 없는 프로젝트는 주요 파일의 mtime으로 변경 여부를 판단한다. CLI의 `scan`·`report` 커맨드에 `--incremental` 플래그를 추가하고 `loadScanResult()`를 확장한다.

**Tech Stack:** TypeScript, vitest, simple-git, Node.js `fs/promises`

---

## 변경 파일 요약

| 파일 | 변경 내용 |
|------|----------|
| `src/core/Scanner.ts` | `isProjectChanged()` (public), `scanIncremental()` 추가 |
| `src/core/Scanner.test.ts` | 증분 스캔 테스트 5개 추가 |
| `src/cli/index.ts` | `scan --incremental`, `report --incremental` 플래그, `loadScanResult()` 확장 |

새 파일 없음. `ScanStore`, `HistoryStore`, `ProjectModel` 변경 없음.

---

## Task 1: `isProjectChanged()` — 변경 감지 로직 + 테스트

**Files:**
- Modify: `src/core/Scanner.ts`
- Test: `src/core/Scanner.test.ts`

- [ ] **Step 1: `isProjectChanged` 테스트 작성 (비-git, 변경됨)**

`src/core/Scanner.test.ts` 끝에 새 `describe` 블록 추가:

```ts
describe("Scanner.isProjectChanged", () => {
  it("non-git 프로젝트에서 최근 파일이 있으면 변경됨으로 판단한다", async () => {
    const projectDir = path.join(tempRoot, "no-git-new");
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, "README.md"), "# Hello");

    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const candidate = {
      name: "no-git-new",
      path: projectDir,
      hasReadme: true,
      hasClaude: false,
      hasGit: false,
    };
    // lastScannedAt은 파일 생성 이전 시각
    const lastScannedAt = new Date(Date.now() - 10_000);

    const changed = await scanner.isProjectChanged(candidate, lastScannedAt);
    expect(changed).toBe(true);
  });
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

```bash
cd /Users/jean325/portfolio/portfolio-tracker/.claude/worktrees/upbeat-nash-ba71fd
npx vitest run src/core/Scanner.test.ts 2>&1 | tail -20
```

Expected: `isProjectChanged is not a function` 또는 유사한 오류로 FAIL.

- [ ] **Step 3: `isProjectChanged` 구현 — non-git mtime 체크**

`src/core/Scanner.ts`의 `scan()` 메서드 바로 아래에 추가:

```ts
// 변경 감지 대상 파일 목록 (non-git 프로젝트용)
private static readonly WATCHED_FILES = [
  "README.md", "readme.md",
  "CLAUDE.md",
  "PROJECT_PLAN.md",
  "TODO.md", "TODO.txt",
  "package.json",
  "pubspec.yaml",
  "build.gradle", "build.gradle.kts",
  "requirements.txt",
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
      return new Date(log.latest.date) > lastScannedAt;
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
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

```bash
npx vitest run src/core/Scanner.test.ts 2>&1 | tail -20
```

Expected: 기존 4개 + 새 1개 = 5개 PASS.

- [ ] **Step 5: non-git 변경 없음 테스트 추가 + 통과 확인**

```ts
  it("non-git 프로젝트에서 미래 시각 기준이면 변경 없음으로 판단한다", async () => {
    const projectDir = path.join(tempRoot, "no-git-old");
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, "README.md"), "# Stable");

    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const candidate = {
      name: "no-git-old",
      path: projectDir,
      hasReadme: true,
      hasClaude: false,
      hasGit: false,
    };
    // lastScannedAt이 미래 → 모든 파일이 오래된 것으로 간주
    const lastScannedAt = new Date(Date.now() + 60_000);

    const changed = await scanner.isProjectChanged(candidate, lastScannedAt);
    expect(changed).toBe(false);
  });
```

```bash
npx vitest run src/core/Scanner.test.ts 2>&1 | tail -20
```

Expected: 6개 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/core/Scanner.ts src/core/Scanner.test.ts
git commit -m "feat: add Scanner.isProjectChanged() for incremental change detection"
```

---

## Task 2: `scanIncremental()` + 테스트

**Files:**
- Modify: `src/core/Scanner.ts`
- Test: `src/core/Scanner.test.ts`

- [ ] **Step 1: scanIncremental 테스트 — 변경 없는 프로젝트는 캐시 재사용**

```ts
describe("Scanner.scanIncremental", () => {
  it("변경 없는 프로젝트는 캐시 데이터를 그대로 반환한다", async () => {
    const projectDir = path.join(tempRoot, "stable");
    await fs.mkdir(projectDir);
    await fs.writeFile(
      path.join(projectDir, "README.md"),
      "# Stable\n\n진행률: 50%",
    );

    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const firstResult = await scanner.scan();

    // lastScannedAt을 미래로 설정 → 변경 없음
    const fakeLastResult = { ...firstResult, scannedAt: new Date(Date.now() + 60_000) };
    const { result, rescanned, reused } = await scanner.scanIncremental(fakeLastResult);

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe("stable");
    expect(rescanned).toBe(0);
    expect(reused).toBe(1);
  });
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

```bash
npx vitest run src/core/Scanner.test.ts 2>&1 | tail -20
```

Expected: `scanIncremental is not a function`으로 FAIL.

- [ ] **Step 3: `scanIncremental` 구현**

`src/core/Scanner.ts`의 `scanIncremental()` 추가 (`isProjectChanged` 바로 아래):

```ts
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

  let rescanned = 0;
  let reused = 0;

  const projects = await Promise.all(
    candidates.map(async (candidate) => {
      const id = this.slug(candidate.path);
      const cached = cachedById.get(id);

      if (cached) {
        const changed = await this.isProjectChanged(candidate, lastScannedAt);
        if (!changed) {
          reused++;
          return cached;
        }
      }

      rescanned++;
      return this.analyzeProject(candidate);
    }),
  );

  const sortedProjects = projects.sort((a, b) => {
    const priorityOrder: Record<Priority, number> = {
      CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3,
    };
    const priorityDiff =
      priorityOrder[a.priority ?? "LOW"] -
      priorityOrder[b.priority ?? "LOW"];
    if (priorityDiff !== 0) return priorityDiff;
    return b.activity.daysSinceLastCommit - a.activity.daysSinceLastCommit;
  });

  const result: ScanResult = {
    projects: sortedProjects,
    scannedAt: new Date(),
    summary: this.buildSummary(sortedProjects),
  };

  return { result, rescanned, reused };
}
```

`slug` 메서드를 `private`에서 `private`으로 유지하되 `scanIncremental` 내에서 사용하므로 `this.slug` 접근 가능 (이미 `private`이어도 같은 클래스 내에서 OK).

- [ ] **Step 4: 테스트 실행해서 통과 확인**

```bash
npx vitest run src/core/Scanner.test.ts 2>&1 | tail -20
```

Expected: 7개 PASS.

- [ ] **Step 5: 변경된 프로젝트는 재스캔하는 테스트 추가**

```ts
  it("변경된 프로젝트는 재분석해서 최신 진행률을 반영한다", async () => {
    const projectDir = path.join(tempRoot, "changing");
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, "README.md"), "# Changing");

    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const firstResult = await scanner.scan();
    expect(firstResult.projects[0].progress.percentage).toBeNull();

    // 파일 수정 (진행률 추가)
    await fs.writeFile(
      path.join(projectDir, "README.md"),
      "# Changing\n\n진행률: 80%",
    );

    // lastScannedAt을 과거로 → 변경됨으로 감지
    const oldResult = { ...firstResult, scannedAt: new Date(Date.now() - 10_000) };
    const { result, rescanned } = await scanner.scanIncremental(oldResult);

    expect(result.projects[0].progress.percentage).toBe(80);
    expect(rescanned).toBe(1);
  });

  it("삭제된 프로젝트는 결과에서 제거된다", async () => {
    const projectDir = path.join(tempRoot, "to-delete");
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, "README.md"), "# ToDelete");

    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const firstResult = await scanner.scan();
    expect(firstResult.projects).toHaveLength(1);

    // 프로젝트 폴더 삭제
    await fs.rm(projectDir, { recursive: true });

    const { result } = await scanner.scanIncremental(firstResult);
    expect(result.projects).toHaveLength(0);
  });

  it("새 프로젝트는 캐시에 없어도 자동으로 스캔된다", async () => {
    // 먼저 빈 스캔 결과 생성
    const scanner = new Scanner({ projectDirs: [tempRoot] });
    const emptyResult = await scanner.scan();
    expect(emptyResult.projects).toHaveLength(0);

    // 새 프로젝트 추가
    const projectDir = path.join(tempRoot, "brand-new");
    await fs.mkdir(projectDir);
    await fs.writeFile(path.join(projectDir, "README.md"), "# New");

    const { result, rescanned } = await scanner.scanIncremental(emptyResult);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe("brand-new");
    expect(rescanned).toBe(1);
  });
});
```

- [ ] **Step 6: 테스트 실행해서 통과 확인**

```bash
npx vitest run src/core/Scanner.test.ts 2>&1 | tail -20
```

Expected: 10개 PASS.

- [ ] **Step 7: 커밋**

```bash
git add src/core/Scanner.ts src/core/Scanner.test.ts
git commit -m "feat: add Scanner.scanIncremental() with change detection"
```

---

## Task 3: CLI `scan --incremental` 플래그

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: `scan` 커맨드에 `--incremental` 옵션 추가**

`src/cli/index.ts`에서 `scan` 커맨드 action 시그니처와 구현을 교체:

기존:
```ts
.option("--no-save", "스캔 결과를 파일로 저장하지 않음")
.action(async (options: { save?: boolean }) => {
  const configManager = new ConfigManager();
  const config = await configManager.load();

  console.log(chalk.blue("🔍 프로젝트 스캔 중..."));

  const scanner = new Scanner(config);
  const result = await scanner.scan();
```

변경 후:
```ts
.option("--no-save", "스캔 결과를 파일로 저장하지 않음")
.option("--incremental", "변경된 프로젝트만 재스캔 (캐시 없으면 전체 스캔)")
.action(async (options: { save?: boolean; incremental?: boolean }) => {
  const configManager = new ConfigManager();
  const config = await configManager.load();
  const scanner = new Scanner(config);
  const store = new ScanStore();

  let result;
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
      ({ result, rescanned, reused } = await scanner.scanIncremental(lastResult));
    } else {
      console.log(chalk.yellow("⚠ 저장된 스캔 없음, 전체 스캔으로 진행합니다."));
      console.log(chalk.blue("🔍 프로젝트 스캔 중..."));
      result = await scanner.scan();
    }
  } else {
    console.log(chalk.blue("🔍 프로젝트 스캔 중..."));
    result = await scanner.scan();
  }
```

그리고 결과 출력 부분에서 `result.projects.length` 뒤에 증분 통계 추가:

기존:
```ts
  console.log(
    chalk.green(`✓ ${result.projects.length}개의 프로젝트를 찾았습니다!\n`),
  );
```

변경 후:
```ts
  if (options.incremental && reused > 0) {
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
```

- [ ] **Step 2: 빌드 확인**

```bash
cd /Users/jean325/portfolio/portfolio-tracker/.claude/worktrees/upbeat-nash-ba71fd
npm run build 2>&1 | tail -20
```

Expected: 오류 없이 `dist/` 생성.

- [ ] **Step 3: 커밋**

```bash
git add src/cli/index.ts
git commit -m "feat: add --incremental flag to scan command"
```

---

## Task 4: `report --incremental` + `loadScanResult()` 확장

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: `loadScanResult` 시그니처 및 구현 업데이트**

기존 `loadScanResult` 함수:
```ts
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
```

변경 후:
```ts
async function loadScanResult(options: {
  refresh?: boolean;
  incremental?: boolean;
}) {
  const configManager = new ConfigManager();
  const config = await configManager.load();
  const scanner = new Scanner(config);
  const store = new ScanStore();

  // refresh 없음: 캐시 그대로 사용
  if (!options.refresh) {
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
```

- [ ] **Step 2: `report` 커맨드에 `--incremental` 옵션 추가**

기존:
```ts
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
```

변경 후:
```ts
program
  .command("report")
  .description("프로젝트 진행 리포트 출력")
  .option("-a, --all", "LOW 우선순위 프로젝트까지 모두 표시")
  .option("-r, --refresh", "저장된 결과 대신 새로 스캔")
  .option("--incremental", "증분 스캔으로 새로고침 (--refresh와 함께 사용)")
  .action(async (options: { all?: boolean; refresh?: boolean; incremental?: boolean }) => {
    console.log(chalk.blue("프로젝트 리포트 생성 중..."));
    const { result, fromCache } = await loadScanResult({
      refresh: options.refresh,
      incremental: options.incremental,
    });
```

- [ ] **Step 3: `export` 커맨드에도 `--incremental` 옵션 추가**

기존:
```ts
program
  .command("export")
  ...
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
```

변경 후:
```ts
  .option("-r, --refresh", "저장된 결과 대신 새로 스캔")
  .option("--incremental", "증분 스캔으로 새로고침 (--refresh와 함께 사용)")
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
```

- [ ] **Step 4: 빌드 + 전체 테스트 확인**

```bash
npm run build 2>&1 | tail -10
npx vitest run 2>&1 | tail -20
```

Expected: 빌드 성공, 전체 테스트 PASS.

- [ ] **Step 5: 수동 동작 확인**

```bash
# 전체 스캔 먼저
node dist/cli/index.js scan

# 증분 스캔
node dist/cli/index.js scan --incremental
# Expected: "🔍 증분 스캔 중... (마지막 스캔: 0일 전)"
# Expected: "✓ N개 프로젝트 (0개 재스캔, N개 캐시)"

# 캐시 없을 때 fallback 확인
rm -rf .portfolio-tracker/scan-result.json
node dist/cli/index.js scan --incremental
# Expected: "⚠ 저장된 스캔 없음, 전체 스캔으로 진행합니다."
```

- [ ] **Step 6: 커밋**

```bash
git add src/cli/index.ts
git commit -m "feat: add --incremental flag to report/export commands and update loadScanResult"
```

---

## 완료 기준

- `npx vitest run` — 전체 테스트 통과 (기존 4개 + 신규 6개)
- `npm run build` — 오류 없이 빌드
- `portfolio-tracker scan --incremental` — 변경 없을 때 "N개 캐시" 메시지
- `portfolio-tracker report --refresh --incremental` — 증분 스캔 후 리포트 출력
- 캐시 없을 때 `--incremental` → 전체 스캔으로 graceful fallback
