import fs from "fs/promises";
import os from "os";
import path from "path";
import type { KakaoConfig, ScanResult } from "./ProjectModel.js";
import type { ScanDiff } from "./TrendAnalyzer.js";
import {
  countMeaningfulProgressChanges,
  hasMeaningfulNotificationChange,
  type NotificationPolicyOptions,
} from "./NotificationPolicy.js";

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

export type KakaoDiagnosticLevel = "info" | "warning" | "error";

export interface KakaoStatusDiagnostic {
  level: KakaoDiagnosticLevel;
  message: string;
  action?: string;
}

export interface KakaoStatus {
  configured: boolean;
  tokenFile: string;
  hasToken: boolean;
  tokenError?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  scope?: string;
  hasTalkMessageScope: boolean | null;
  linkUrl: string;
  linkUrlValid: boolean;
  linkUrlOrigin?: string;
  linkUrlIsDefault: boolean;
  diagnostics: KakaoStatusDiagnostic[];
}

const AUTH_URL = "https://kauth.kakao.com/oauth/authorize";
const TOKEN_URL = "https://kauth.kakao.com/oauth/token";
const SEND_TO_ME_URL = "https://kapi.kakao.com/v2/api/talk/memo/default/send";
const DEFAULT_REDIRECT_URI = "http://localhost:4888/kakao/callback";
const DEFAULT_TOKEN_FILE = ".portfolio-tracker/kakao-token.json";
const DEFAULT_LINK_URL = "https://developers.kakao.com";
const TOKEN_REFRESH_SKEW_MS = 60_000;
const ACCESS_TOKEN_EXPIRY_WARNING_MS = 10 * 60 * 1000;
const REFRESH_TOKEN_EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;
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

  async status(): Promise<KakaoStatus> {
    let token: KakaoTokenSet | null = null;
    let tokenError: string | undefined;

    try {
      token = await this.loadToken();
    } catch (error) {
      tokenError = error instanceof Error ? error.message : String(error);
    }

    const linkUrlInfo = inspectLinkUrl(this.linkUrl);
    const status: KakaoStatus = {
      configured: this.hasRestApiKey,
      tokenFile: this.tokenFile,
      hasToken: token !== null,
      tokenError,
      accessTokenExpiresAt: token?.accessTokenExpiresAt,
      refreshTokenExpiresAt: token?.refreshTokenExpiresAt,
      scope: token?.scope,
      hasTalkMessageScope: inspectTalkMessageScope(token?.scope),
      linkUrl: this.linkUrl,
      linkUrlValid: linkUrlInfo.valid,
      linkUrlOrigin: linkUrlInfo.origin,
      linkUrlIsDefault: this.linkUrl === DEFAULT_LINK_URL,
      diagnostics: [],
    };

    status.diagnostics = buildKakaoStatusDiagnostics(status);
    return status;
  }

  async sendPortfolioSummary(
    result: ScanResult,
    diff: ScanDiff | null,
    options: NotificationPolicyOptions = {},
  ): Promise<void> {
    await this.sendTextToMe(buildKakaoScanMessage(result, diff, options));
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

export function buildKakaoScanMessage(
  result: ScanResult,
  diff: ScanDiff | null,
  options: NotificationPolicyOptions = {},
): string {
  const progress =
    result.summary.avgProgress === null
      ? "판단 불가"
      : `${result.summary.avgProgress}%`;
  const changeLine = diff
    ? summarizeDiff(diff, options)
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

function summarizeDiff(
  diff: ScanDiff,
  options: NotificationPolicyOptions = {},
): string {
  const added = diff.projects.filter(
    (project) => project.status === "new",
  ).length;
  const removed = diff.projects.filter(
    (project) => project.status === "removed",
  ).length;
  const changed = countMeaningfulProgressChanges(diff, options);

  if (added === 0 && removed === 0 && changed === 0) {
    return "큰 변화 없음";
  }

  return `신규 ${added} · 제거 ${removed} · 진행률 변화 ${changed}`;
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

function inspectTalkMessageScope(scope: string | undefined): boolean | null {
  if (!scope) {
    return null;
  }

  return scope.split(/[\s,]+/).includes("talk_message");
}

function inspectLinkUrl(linkUrl: string): { valid: boolean; origin?: string } {
  try {
    const url = new URL(linkUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      return { valid: false };
    }

    return { valid: true, origin: url.origin };
  } catch {
    return { valid: false };
  }
}

function buildKakaoStatusDiagnostics(
  status: KakaoStatus,
): KakaoStatusDiagnostic[] {
  const diagnostics: KakaoStatusDiagnostic[] = [];

  if (!status.configured) {
    diagnostics.push({
      level: "error",
      message: "REST API 키가 설정되지 않았습니다.",
      action: "portfolio-tracker config kakao --rest-api-key YOUR_REST_API_KEY",
    });
  }

  if (!status.hasToken) {
    diagnostics.push({
      level: "error",
      message: status.tokenError
        ? `토큰을 읽을 수 없습니다: ${status.tokenError}`
        : "저장된 카카오 토큰이 없습니다.",
      action: "portfolio-tracker kakao auth",
    });
  }

  if (status.hasTalkMessageScope === false) {
    diagnostics.push({
      level: "error",
      message: "토큰 scope에 talk_message 권한이 없습니다.",
      action:
        "Kakao Developers 동의 항목에서 talk_message를 켠 뒤 kakao auth를 다시 실행하세요.",
    });
  } else if (status.hasToken && status.hasTalkMessageScope === null) {
    diagnostics.push({
      level: "warning",
      message: "토큰 scope 정보를 확인할 수 없습니다.",
      action: "메시지 전송이 실패하면 kakao auth를 다시 실행하세요.",
    });
  }

  addExpiryDiagnostic(
    diagnostics,
    "Access token",
    status.accessTokenExpiresAt,
    ACCESS_TOKEN_EXPIRY_WARNING_MS,
  );
  addExpiryDiagnostic(
    diagnostics,
    "Refresh token",
    status.refreshTokenExpiresAt,
    REFRESH_TOKEN_EXPIRY_WARNING_MS,
  );

  if (!status.linkUrlValid) {
    diagnostics.push({
      level: "error",
      message: `linkUrl이 올바른 http(s) URL이 아닙니다: ${status.linkUrl}`,
      action:
        "portfolio-tracker config kakao --link-url https://YOUR_DOMAIN/portfolio-tracker/",
    });
  } else if (status.linkUrlIsDefault) {
    diagnostics.push({
      level: "warning",
      message: "linkUrl이 기본 개발자 문서 URL로 설정되어 있습니다.",
      action: "카카오 메시지 버튼이 열 실제 리포트 URL로 바꾸세요.",
    });
  } else if (status.linkUrlOrigin) {
    diagnostics.push({
      level: "info",
      message: `Kakao Developers Web domain 등록 후보: ${status.linkUrlOrigin}`,
      action:
        "카카오 메시지 링크가 동작하려면 이 도메인이 앱 플랫폼 설정에 등록되어 있어야 합니다.",
    });
  }

  return diagnostics;
}

function addExpiryDiagnostic(
  diagnostics: KakaoStatusDiagnostic[],
  label: string,
  expiresAt: string | undefined,
  warningMs: number,
): void {
  if (!expiresAt) {
    return;
  }

  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) {
    diagnostics.push({
      level: "warning",
      message: `${label} 만료 시각을 해석할 수 없습니다: ${expiresAt}`,
      action: "메시지 전송이 실패하면 kakao auth를 다시 실행하세요.",
    });
    return;
  }

  const remainingMs = timestamp - Date.now();
  if (remainingMs <= 0) {
    diagnostics.push({
      level: label === "Refresh token" ? "error" : "warning",
      message: `${label}이 만료되었습니다.`,
      action:
        label === "Refresh token"
          ? "portfolio-tracker kakao auth"
          : "다음 메시지 전송 때 refresh token으로 갱신을 시도합니다.",
    });
    return;
  }

  if (remainingMs <= warningMs) {
    diagnostics.push({
      level: "warning",
      message: `${label} 만료가 임박했습니다: ${expiresAt}`,
      action:
        label === "Refresh token"
          ? "portfolio-tracker kakao auth"
          : "다음 메시지 전송 때 자동 갱신될 수 있습니다.",
    });
  }
}

async function formatKakaoError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return `Kakao API failed: ${response.status} ${response.statusText}`;
  }
  return `Kakao API failed: ${response.status} ${response.statusText} ${text}`;
}
