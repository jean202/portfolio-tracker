import fs from "fs/promises";
import path from "path";
import inquirer from "inquirer";
import { Config } from "../core/ProjectModel.js";

const CONFIG_FILE = path.join(process.cwd(), "config.json");

const DEFAULT_CONFIG: Config = {
  projectDirs: [
    "~/portfolio/projects",
    "~/IdeaProjects",
    "~/JsProjects",
    "~/PythonProjects",
    "~/PycharmProjects",
  ],
  scanInterval: 24 * 60 * 60 * 1000, // 24시간
  excludePatterns: ["node_modules", ".git", ".next", "dist", "build"],
};

export class ConfigManager {
  private config: Config | null = null;

  constructor(private readonly configFile = CONFIG_FILE) {}

  async load(): Promise<Config> {
    if (this.config) {
      return this.config;
    }

    try {
      const content = await fs.readFile(this.configFile, "utf-8");
      const config = JSON.parse(content) as Config;
      this.config = config;
      return config;
    } catch {
      // 파일이 없으면 기본값 사용
      this.config = {
        ...DEFAULT_CONFIG,
        projectDirs: [...DEFAULT_CONFIG.projectDirs],
      };
      return this.config;
    }
  }

  async save(config: Config): Promise<void> {
    const content = JSON.stringify(config, null, 2);
    await fs.writeFile(this.configFile, content, "utf-8");
    this.config = config;
  }

  async init(interactive = true): Promise<Config> {
    if (!interactive) {
      const config = {
        ...DEFAULT_CONFIG,
        projectDirs: [...DEFAULT_CONFIG.projectDirs],
      };
      await this.save(config);
      return config;
    }

    const answers = await inquirer.prompt([
      {
        type: "confirm",
        name: "useDefaults",
        message: "기본 디렉토리를 사용하시겠어요?",
        default: true,
      },
    ]);

    let projectDirs = [...DEFAULT_CONFIG.projectDirs];

    if (!answers.useDefaults) {
      const customAnswers = await inquirer.prompt([
        {
          type: "input",
          name: "customDirs",
          message:
            "포트폴리오 디렉토리를 입력하세요 (쉼표로 구분, 예: ~/projects, ~/work):",
          validate: (input: string) =>
            input.trim().length > 0 ||
            "최소 하나의 디렉토리를 입력해야 합니다.",
          filter: (input: string) =>
            input
              .split(",")
              .map((dir: string) => dir.trim())
              .filter((dir: string) => dir.length > 0),
        },
      ]);
      projectDirs = customAnswers.customDirs as string[];
    }

    const finalAnswers = await inquirer.prompt([
      {
        type: "confirm",
        name: "addMore",
        message: "추가 디렉토리를 더 추가하시겠어요?",
        default: false,
      },
    ]);

    if (finalAnswers.addMore) {
      let addingMore = true;
      while (addingMore) {
        const moreAnswers = await inquirer.prompt([
          {
            type: "input",
            name: "dir",
            message: "디렉토리를 입력하세요:",
            validate: (input) =>
              input.trim().length > 0 || "디렉토리를 입력해야 합니다.",
          },
        ]);
        projectDirs.push(moreAnswers.dir.trim());

        const continueAnswers = await inquirer.prompt([
          {
            type: "confirm",
            name: "continue",
            message: "더 추가하시겠어요?",
            default: false,
          },
        ]);
        addingMore = continueAnswers.continue;
      }
    }

    const config: Config = {
      projectDirs: [...new Set(projectDirs)],
      scanInterval: DEFAULT_CONFIG.scanInterval,
      excludePatterns: DEFAULT_CONFIG.excludePatterns
        ? [...DEFAULT_CONFIG.excludePatterns]
        : undefined,
    };

    await this.save(config);
    return config;
  }

  async addProjectDir(dir: string): Promise<boolean> {
    const config = await this.load();
    if (!config.projectDirs.includes(dir)) {
      config.projectDirs.push(dir);
      await this.save(config);
      return true;
    }

    return false;
  }

  async removeProjectDir(dir: string): Promise<boolean> {
    const config = await this.load();
    const before = config.projectDirs.length;
    config.projectDirs = config.projectDirs.filter((d) => d !== dir);
    if (config.projectDirs.length !== before) {
      await this.save(config);
      return true;
    }

    return false;
  }

  async getConfig(): Promise<Config> {
    return this.load();
  }

  expandPath(dirPath: string): string {
    if (dirPath.startsWith("~")) {
      return dirPath.replace("~", process.env.HOME || "");
    }
    return dirPath;
  }

  expandPaths(dirs: string[]): string[] {
    return dirs.map((d) => this.expandPath(d));
  }
}
