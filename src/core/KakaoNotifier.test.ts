import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildKakaoScanMessage,
  KakaoNotifier,
  shouldNotifyKakao,
} from "./KakaoNotifier.js";
import type { ScanDiff } from "./TrendAnalyzer.js";
import type { ScanResult } from "./ProjectModel.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KakaoNotifier", () => {
  it("builds an authorization URL with talk_message scope", () => {
    const notifier = new KakaoNotifier({
      restApiKey: "rest-key",
      redirectUri: "http://localhost:4888/kakao/callback",
    });
    const url = new URL(notifier.getAuthorizationUrl("state-1"));

    expect(url.origin + url.pathname).toBe(
      "https://kauth.kakao.com/oauth/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("rest-key");
    expect(url.searchParams.get("scope")).toBe("talk_message");
    expect(url.searchParams.get("state")).toBe("state-1");
  });

  it("exchanges an auth code and stores token data", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kakao-token-"));
    const tokenFile = path.join(tempDir, "token.json");
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token_type: "bearer",
        access_token: "access",
        expires_in: 100,
        refresh_token: "refresh",
        refresh_token_expires_in: 200,
        scope: "talk_message",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const notifier = new KakaoNotifier({
      restApiKey: "rest-key",
      redirectUri: "http://localhost:4888/kakao/callback",
      tokenFile,
    });
    await notifier.exchangeCode("code-1");

    const saved = JSON.parse(await fs.readFile(tokenFile, "utf-8"));
    expect(saved.accessToken).toBe("access");
    expect(saved.refreshToken).toBe("refresh");
    expect(saved.scope).toBe("talk_message");
  });

  it("sends a text template to my chatroom", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kakao-token-"));
    const tokenFile = path.join(tempDir, "token.json");
    await fs.writeFile(
      tokenFile,
      JSON.stringify({
        tokenType: "bearer",
        accessToken: "access",
        accessTokenExpiresAt: new Date(Date.now() + 120_000).toISOString(),
        refreshToken: "refresh",
      }),
    );
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "",
    });
    vi.stubGlobal("fetch", mockFetch);

    const notifier = new KakaoNotifier({
      restApiKey: "rest-key",
      tokenFile,
      linkUrl: "https://example.com",
    });
    await notifier.sendTextToMe("hello");

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://kapi.kakao.com/v2/api/talk/memo/default/send",
    );
    expect(mockFetch.mock.calls[0][1].headers.authorization).toBe(
      "Bearer access",
    );
  });

  it("includes execution params when screen is provided", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kakao-token-"));
    const tokenFile = path.join(tempDir, "token.json");
    await fs.writeFile(
      tokenFile,
      JSON.stringify({
        tokenType: "bearer",
        accessToken: "access",
        accessTokenExpiresAt: new Date(Date.now() + 120_000).toISOString(),
        refreshToken: "refresh",
      }),
    );
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "",
    });
    vi.stubGlobal("fetch", mockFetch);

    const notifier = new KakaoNotifier({
      restApiKey: "rest-key",
      tokenFile,
      linkUrl: "https://example.com",
    });
    await notifier.sendTextToMe("hello", { screen: "recommendations" });

    const body = mockFetch.mock.calls[0][1].body as URLSearchParams;
    const template = JSON.parse(body.get("template_object")!);
    expect(template.link.ios_execution_params).toBe("screen=recommendations");
    expect(template.link.android_execution_params).toBe(
      "screen=recommendations",
    );
    expect(template.link.web_url).toBe("https://example.com");
  });

  it("omits execution params when screen is not provided", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kakao-token-"));
    const tokenFile = path.join(tempDir, "token.json");
    await fs.writeFile(
      tokenFile,
      JSON.stringify({
        tokenType: "bearer",
        accessToken: "access",
        accessTokenExpiresAt: new Date(Date.now() + 120_000).toISOString(),
        refreshToken: "refresh",
      }),
    );
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "",
    });
    vi.stubGlobal("fetch", mockFetch);

    const notifier = new KakaoNotifier({ restApiKey: "rest-key", tokenFile });
    await notifier.sendTextToMe("hello");

    const body = mockFetch.mock.calls[0][1].body as URLSearchParams;
    const template = JSON.parse(body.get("template_object")!);
    expect(template.link.ios_execution_params).toBeUndefined();
    expect(template.link.android_execution_params).toBeUndefined();
  });

  it("sends portfolio summary with dashboard screen param", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kakao-token-"));
    const tokenFile = path.join(tempDir, "token.json");
    await fs.writeFile(
      tokenFile,
      JSON.stringify({
        tokenType: "bearer",
        accessToken: "access",
        accessTokenExpiresAt: new Date(Date.now() + 120_000).toISOString(),
        refreshToken: "refresh",
      }),
    );
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "",
    });
    vi.stubGlobal("fetch", mockFetch);

    const notifier = new KakaoNotifier({ restApiKey: "rest-key", tokenFile });
    await notifier.sendPortfolioSummary(makeScanResult(), null);

    const body = mockFetch.mock.calls[0][1].body as URLSearchParams;
    const template = JSON.parse(body.get("template_object")!);
    expect(template.link.ios_execution_params).toBe("screen=dashboard");
  });

  it("diagnoses missing talk_message scope and default link URL", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kakao-token-"));
    const tokenFile = path.join(tempDir, "token.json");
    await fs.writeFile(
      tokenFile,
      JSON.stringify({
        tokenType: "bearer",
        accessToken: "access",
        accessTokenExpiresAt: new Date(Date.now() + 120_000).toISOString(),
        refreshToken: "refresh",
        refreshTokenExpiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        scope: "profile",
      }),
    );

    const notifier = new KakaoNotifier({
      restApiKey: "rest-key",
      tokenFile,
    });
    const status = await notifier.status();

    expect(status.hasTalkMessageScope).toBe(false);
    expect(status.linkUrlIsDefault).toBe(true);
    expect(status.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        "토큰 scope에 talk_message 권한이 없습니다.",
        "linkUrl이 기본 개발자 문서 URL로 설정되어 있습니다.",
      ]),
    );
  });

  it("diagnoses invalid link URL and expired refresh token", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kakao-token-"));
    const tokenFile = path.join(tempDir, "token.json");
    await fs.writeFile(
      tokenFile,
      JSON.stringify({
        tokenType: "bearer",
        accessToken: "access",
        accessTokenExpiresAt: new Date(Date.now() + 120_000).toISOString(),
        refreshToken: "refresh",
        refreshTokenExpiresAt: new Date(Date.now() - 1_000).toISOString(),
        scope: "talk_message",
      }),
    );

    const notifier = new KakaoNotifier({
      restApiKey: "rest-key",
      tokenFile,
      linkUrl: "ftp://example.com",
    });
    const status = await notifier.status();

    expect(status.hasTalkMessageScope).toBe(true);
    expect(status.linkUrlValid).toBe(false);
    expect(status.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: "Refresh token이 만료되었습니다.",
        }),
        expect.objectContaining({
          level: "error",
          message: "linkUrl이 올바른 http(s) URL이 아닙니다: ftp://example.com",
        }),
      ]),
    );
  });
});

describe("shouldNotifyKakao", () => {
  it("respects enabled and notifyOnScan flags", () => {
    expect(
      shouldNotifyKakao({ enabled: false, notifyOnScan: true }, null),
    ).toBe(false);
    expect(shouldNotifyKakao({ enabled: true, notifyOnScan: true }, null)).toBe(
      true,
    );
  });

  it("notifies on meaningful changes", () => {
    const diff = makeDiff({
      projects: [
        {
          name: "project-a",
          before: null,
          after: {} as never,
          status: "new",
          progressChange: null,
          readinessChange: 10,
          activityChange: 0,
        },
      ],
    });

    expect(
      shouldNotifyKakao({ enabled: true, notifyOnChanges: true }, diff),
    ).toBe(true);
  });

  it("uses a custom progress threshold for change notifications", () => {
    const diff = makeDiff({
      projects: [
        {
          name: "project-a",
          before: {} as never,
          after: {} as never,
          status: "changed",
          progressChange: 8,
          readinessChange: 0,
          activityChange: 0,
        },
      ],
    });

    expect(
      shouldNotifyKakao({ enabled: true, notifyOnChanges: true }, diff, {
        progressChangeThreshold: 10,
      }),
    ).toBe(false);
    expect(
      shouldNotifyKakao({ enabled: true, notifyOnChanges: true }, diff, {
        progressChangeThreshold: 8,
      }),
    ).toBe(true);
  });
});

describe("buildKakaoScanMessage", () => {
  it("keeps the message within Kakao text template length", () => {
    const message = buildKakaoScanMessage(makeScanResult(), makeDiff());

    expect(message.length).toBeLessThanOrEqual(200);
    expect(message).toContain("[Portfolio Tracker]");
    expect(message).toContain("전체 16");
  });

  it("uses a custom threshold in the summary line", () => {
    const diff = makeDiff({
      projects: [
        {
          name: "project-a",
          before: {} as never,
          after: {} as never,
          status: "changed",
          progressChange: 8,
          readinessChange: 0,
          activityChange: 0,
        },
      ],
    });

    expect(
      buildKakaoScanMessage(makeScanResult(), diff, {
        progressChangeThreshold: 10,
      }),
    ).toContain("큰 변화 없음");
    expect(
      buildKakaoScanMessage(makeScanResult(), diff, {
        progressChangeThreshold: 8,
      }),
    ).toContain("진행률 변화 1");
  });
});

function makeScanResult(): ScanResult {
  return {
    projects: [],
    scannedAt: new Date("2026-01-02T00:00:00.000Z"),
    summary: {
      total: 16,
      active: 5,
      avgProgress: 56,
      avgReadiness: 59,
      byPriority: { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 13 },
      byType: {
        node: 10,
        python: 1,
        dart: 0,
        java: 0,
        kotlin: 0,
        go: 0,
        rust: 0,
        unknown: 5,
      },
    },
  };
}

function makeDiff(overrides: Partial<ScanDiff> = {}): ScanDiff {
  const summary = makeScanResult().summary;
  return {
    fromDate: new Date("2026-01-01T00:00:00.000Z"),
    toDate: new Date("2026-01-02T00:00:00.000Z"),
    summary: {
      before: summary,
      after: summary,
      changes: {
        total: 0,
        active: 0,
        avgProgress: null,
        avgReadiness: 0,
      },
    },
    projects: [],
    ...overrides,
  };
}
