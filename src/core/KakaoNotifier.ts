import fs from "fs/promises";
import os from "os";
import path from "path";
import type { KakaoConfig, ScanResult } from "./ProjectModel.js";
import type { ScanDiff } from "./TrendAnalyzer.js";

export interface KakaoTokenSet {
  tokenType: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt?: string;
  scope?: string;
}

interface KakaoTokenResponse {
  token_type?: string;
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

export interface KakaoNotifierOptions {
  restApiKey?: string;
  clientSecret?: string;
  redirectUri?: string;
  tokenFile?: string;
  linkUrl?: string;
}

const AUTH_URL = "https://kauth.kakao.com/oauth/authorize";
const TOKEN_URL = "https://kauth.kakao.com/oauth/token";
const SEND_TO_ME_URL = "https://kapi.kakao.com/v2/api/talk/memo/default/send";
const DEFAULT_REDIRECT_URI = "http://localhost:4888/kakao/callback";
const DEFAULT_TOKEN_FILE = ".portfolio-tracker/kakao-token.json";
const DEFAULT_LINK_URL = "https://developers.kakao.com";
const TOKEN_REFRESH_SKEW_MS = 60_000;
const KAKAO_TEXT_LIMIT = 200;

export class KakaoNotifier {
  readonly tokenFile: string;
  readonly redirectUri: string;
  readonly linkUrl: string;
  private readonly restApiKey: string;
  private readonly clientSecret?: string;

  constructor(options: KakaoNotifierOptions = {}) {
    this.restApiKey =
      options.restApiKey ?? process.env.KAKAO_REST_API_KEY ?? "";
    this.clientSecret = options.clientSecret ?? process.env.KAKAO_CLIENT_SECRET;
    this.redirectUri =
      options.redirectUri ??
      process.env.KAKAO_REDIRECT_URI ??
      DEFAULT_REDIRECT_URI;
    this.tokenFile = resolveTokenFile(options.tokenFile ?? DEFAULT_TOKEN_FILE);
    this.linkUrl = options.linkUrl ?? DEFAULT_LINK_URL;
  }

  static fromConfig(config?: KakaoConfig): KakaoNotifier | null {
    if (!config?.enabled) {
      return null;
    }

    return new KakaoNotifier({
      restApiKey: config.restApiKey,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      tokenFile: config.tokenFile,
      linkUrl: config.linkUrl,
    });
  }

  static configured(config?: KakaoConfig): KakaoNotifier {
    return new KakaoNotifier({
      restApiKey: config?.restApiKey,
      clientSecret: config?.clientSecret,
      redirectUri: config?.redirectUri,
      tokenFile: config?.tokenFile,
      linkUrl: config?.linkUrl,
    });
  }

  get hasRestApiKey(): boolean {
    return this.restApiKey.trim().length > 0;
  }

  getAuthorizationUrl(state: string): string {
    this.assertConfigured();

    const url = new URL(AUTH_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.restApiKey);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("scope", "talk_message");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<KakaoTokenSet> {
    this.assertConfigured();

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.restApiKey,
      redirect_uri: this.redirectUri,
      code,
    });
    if (this.clientSecret) {
      body.set("client_secret", this.clientSecret);
    }

    const token = await this.requestToken(body);
    await this.saveToken(token);
    return token;
  }

  async status(): Promise<{
    configured: boolean;
    tokenFile: string;
    hasToken: boolean;
    accessTokenExpiresAt?: string;
    refreshTokenExpiresAt?: string;
    scope?: string;
  }> {
    const token = await this.loadToken().catch(() => null);

    return {
      configured: this.hasRestApiKey,
      tokenFile: this.tokenFile,
      hasToken: token !== null,
      accessTokenExpiresAt: token?.accessTokenExpiresAt,
      refreshTokenExpiresAt: token?.refreshTokenExpiresAt,
      scope: token?.scope,
    };
  }

  async sendPortfolioSummary(
    result: ScanResult,
    diff: ScanDiff | null,
  ): Promise<void> {
    await this.sendTextToMe(buildKakaoScanMessage(result, diff));
  }

  async sendTextToMe(text: string): Promise<void> {
    const accessToken = await this.ensureAccessToken();
    const templateObject = {
      object_type: "text",
      text: truncateForKakao(text),
      link: {
        web_url: this.linkUrl,
        mobile_web_url: this.linkUrl,
      },
      button_title: "리포트 보기",
    };
    const body = new URLSearchParams({
      template_object: JSON.stringify(templateObject),
    });

    const response = await fetch(SEND_TO_ME_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body,
    });

    if (!response.ok) {
      throw new Error(await formatKakaoError(response));
    }
  }

  private async ensureAccessToken(): Promise<string> {
    const token = await this.loadToken();
    const expiresAt = Date.parse(token.accessTokenExpiresAt);

    if (
      Number.isFinite(expiresAt) &&
      expiresAt - Date.now() > TOKEN_REFRESH_SKEW_MS
    ) {
      return token.accessToken;
    }

    return (await this.refreshToken(token)).accessToken;
  }

  private async refreshToken(token: KakaoTokenSet): Promise<KakaoTokenSet> {
    this.assertConfigured();

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.restApiKey,
      refresh_token: token.refreshToken,
    });
    if (this.clientSecret) {
      body.set("client_secret", this.clientSecret);
    }

    const refreshed = await this.requestToken(body, token);
    await this.saveToken(refreshed);
    return refreshed;
  }

  private async requestToken(
    body: URLSearchParams,
    previous?: KakaoTokenSet,
  ): Promise<KakaoTokenSet> {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body,
    });

    if (!response.ok) {
      throw new Error(await formatKakaoError(response));
    }

    const payload = (await response.json()) as KakaoTokenResponse;
    const now = Date.now();

    return {
      tokenType: payload.token_type ?? previous?.tokenType ?? "bearer",
      accessToken: payload.access_token,
      accessTokenExpiresAt: new Date(
        now + payload.expires_in * 1000,
      ).toISOString(),
      refreshToken: payload.refresh_token ?? previous?.refreshToken ?? "",
      refreshTokenExpiresAt: payload.refresh_token_expires_in
        ? new Date(now + payload.refresh_token_expires_in * 1000).toISOString()
        : previous?.refreshTokenExpiresAt,
      scope: payload.scope ?? previous?.scope,
    };
  }

  private async loadToken(): Promise<KakaoTokenSet> {
    const content = await fs.readFile(this.tokenFile, "utf-8");
    const token = JSON.parse(content) as KakaoTokenSet;
    if (!token.accessToken || !token.refreshToken) {
      throw new Error(
        `카카오 토큰 파일이 올바르지 않습니다: ${this.tokenFile}`,
      );
    }
    return token;
  }

  private async saveToken(token: KakaoTokenSet): Promise<void> {
    await fs.mkdir(path.dirname(this.tokenFile), { recursive: true });
    await fs.writeFile(this.tokenFile, `${JSON.stringify(token, null, 2)}\n`, {
      mode: 0o600,
    });
    await fs.chmod(this.tokenFile, 0o600).catch(() => undefined);
  }

  private assertConfigured(): void {
    if (!this.hasRestApiKey) {
      throw new Error(
        "카카오 REST API 키가 필요합니다. config.json의 kakao.restApiKey 또는 KAKAO_REST_API_KEY를 설정하세요.",
      );
    }
  }
}

export function shouldNotifyKakao(
  config: KakaoConfig | undefined,
  diff: ScanDiff | null,
): boolean {
  if (!config?.enabled) {
    return false;
  }

  if (config.notifyOnScan) {
    return true;
  }

  if (config.notifyOnChanges && diff) {
    return hasMeaningfulKakaoChange(diff);
  }

  return false;
}

export function buildKakaoScanMessage(
  result: ScanResult,
  diff: ScanDiff | null,
): string {
  const progress =
    result.summary.avgProgress === null
      ? "판단 불가"
      : `${result.summary.avgProgress}%`;
  const changeLine = diff
    ? summarizeDiff(diff)
    : "첫 스캔 또는 비교 데이터 없음";

  return truncateForKakao(
    [
      "[Portfolio Tracker]",
      changeLine,
      `전체 ${result.summary.total} · 활성 ${result.summary.active}`,
      `평균 진행률 ${progress} · 준비도 ${result.summary.avgReadiness}%`,
    ].join("\n"),
  );
}

function summarizeDiff(diff: ScanDiff): string {
  const added = diff.projects.filter(
    (project) => project.status === "new",
  ).length;
  const removed = diff.projects.filter(
    (project) => project.status === "removed",
  ).length;
  const changed = diff.projects.filter(
    (project) =>
      project.status === "changed" &&
      project.progressChange !== null &&
      Math.abs(project.progressChange) >= 5,
  ).length;

  if (added === 0 && removed === 0 && changed === 0) {
    return "큰 변화 없음";
  }

  return `신규 ${added} · 제거 ${removed} · 진행률 변화 ${changed}`;
}

function hasMeaningfulKakaoChange(diff: ScanDiff): boolean {
  return diff.projects.some(
    (project) =>
      project.status === "new" ||
      project.status === "removed" ||
      (project.progressChange !== null &&
        Math.abs(project.progressChange) >= 5),
  );
}

function truncateForKakao(text: string): string {
  if (text.length <= KAKAO_TEXT_LIMIT) {
    return text;
  }

  return `${text.slice(0, KAKAO_TEXT_LIMIT - 1)}…`;
}

function resolveTokenFile(tokenFile: string): string {
  const expanded = expandHome(tokenFile);
  return path.isAbsolute(expanded)
    ? expanded
    : path.resolve(process.cwd(), expanded);
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

async function formatKakaoError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return `Kakao API failed: ${response.status} ${response.statusText}`;
  }
  return `Kakao API failed: ${response.status} ${response.statusText} ${text}`;
}
