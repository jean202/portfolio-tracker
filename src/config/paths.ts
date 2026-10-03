import fs from "fs/promises";
import os from "os";
import path from "path";

/** 데이터 디렉토리를 덮어쓰는 환경변수 */
export const DATA_DIR_ENV = "PORTFOLIO_TRACKER_HOME";

/**
 * 설정·스캔 결과·히스토리·토큰을 저장하는 사용자별 디렉토리.
 * 실행 위치와 상관없이 항상 같은 곳을 가리킨다.
 * 기본값은 ~/.portfolio-tracker, PORTFOLIO_TRACKER_HOME으로 바꿀 수 있다.
 */
export function getDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[DATA_DIR_ENV]?.trim();
  if (override) {
    return path.resolve(expandHome(override));
  }
  return path.join(os.homedir(), ".portfolio-tracker");
}

export function dataPath(...segments: string[]): string {
  return path.join(getDataDir(), ...segments);
}

export function getConfigFile(): string {
  return dataPath("config.json");
}

export function getScanResultFile(): string {
  return dataPath("scan-result.json");
}

export function getHistoryDir(): string {
  return dataPath("history");
}

export function getThreadCacheFile(): string {
  return dataPath("thread-cache.json");
}

export function getKakaoTokenFile(): string {
  return dataPath("kakao-token.json");
}

/**
 * 예전 버전은 실행한 폴더 기준으로 아래 위치에 저장했다.
 *   <root>/config.json
 *   <root>/.portfolio-tracker/{scan-result.json,history/,thread-cache.json,kakao-token.json}
 */
const LEGACY_ITEMS: Array<{ from: string[]; to: string }> = [
  { from: ["config.json"], to: "config.json" },
  { from: [".portfolio-tracker", "scan-result.json"], to: "scan-result.json" },
  { from: [".portfolio-tracker", "history"], to: "history" },
  {
    from: [".portfolio-tracker", "thread-cache.json"],
    to: "thread-cache.json",
  },
  { from: [".portfolio-tracker", "kakao-token.json"], to: "kakao-token.json" },
];

/**
 * 데이터 디렉토리가 아직 없을 때만, 예전 위치(legacyRoots)의 파일을 복사해온다.
 * 원본은 지우지 않는다. 복사한 항목 이름 목록을 반환한다.
 */
export async function migrateLegacyData(
  legacyRoots: string[],
  dataDir = getDataDir(),
): Promise<string[]> {
  if (await exists(dataDir)) {
    return [];
  }

  const roots = [...new Set(legacyRoots.map((root) => path.resolve(root)))];
  const copies: Array<{ src: string; dest: string; name: string }> = [];

  for (const item of LEGACY_ITEMS) {
    const dest = path.join(dataDir, item.to);
    for (const root of roots) {
      const src = path.join(root, ...item.from);
      if (src === dest || !(await exists(src))) continue;
      if (item.to === "config.json" && !(await isTrackerConfig(src))) continue;
      copies.push({ src, dest, name: item.to });
      break;
    }
  }

  if (copies.length === 0) {
    return [];
  }

  await fs.mkdir(dataDir, { recursive: true });
  for (const { src, dest } of copies) {
    await fs.cp(src, dest, { recursive: true });
  }
  if (copies.some((copy) => copy.name === "kakao-token.json")) {
    await fs
      .chmod(path.join(dataDir, "kakao-token.json"), 0o600)
      .catch(() => undefined);
  }
  return copies.map((copy) => copy.name);
}

/** 다른 도구의 config.json을 잘못 가져오지 않도록 모양을 확인한다. */
async function isTrackerConfig(file: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf-8")) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as { projectDirs?: unknown }).projectDirs)
    );
  } catch {
    return false;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
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
