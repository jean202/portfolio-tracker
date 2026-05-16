import { describe, it, expect, vi, afterEach } from "vitest";
import { WebhookNotifier } from "./WebhookNotifier.js";
import type { ScanDiff } from "./TrendAnalyzer.js";
import type { ScanResult } from "./ProjectModel.js";

function makeDiff(overrides: Partial<ScanDiff> = {}): ScanDiff {
  const emptySummary: ScanResult["summary"] = {
    total: 0, active: 0, avgProgress: null, avgReadiness: 0,
    byPriority: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    byType: { node: 0, python: 0, dart: 0, java: 0, kotlin: 0, go: 0, rust: 0, unknown: 0 },
  };
  return {
    fromDate: new Date("2026-01-01"),
    toDate: new Date("2026-01-02"),
    summary: {
      before: emptySummary,
      after: emptySummary,
      changes: { total: 0, active: 0, avgProgress: null, avgReadiness: 0 },
    },
    projects: [],
    ...overrides,
  };
}

describe("WebhookNotifier.shouldNotify", () => {
  it("새 프로젝트가 있으면 true를 반환한다", () => {
    const diff = makeDiff({
      projects: [
        { name: "new-proj", before: null, after: {} as any,
          status: "new", progressChange: null, readinessChange: 50, activityChange: 0 },
      ],
    });
    expect(WebhookNotifier.shouldNotify(diff)).toBe(true);
  });

  it("삭제된 프로젝트가 있으면 true를 반환한다", () => {
    const diff = makeDiff({
      projects: [
        { name: "gone-proj", before: {} as any, after: null,
          status: "removed", progressChange: null, readinessChange: -50, activityChange: 0 },
      ],
    });
    expect(WebhookNotifier.shouldNotify(diff)).toBe(true);
  });

  it("진행률 변화가 5%p 이상이면 true를 반환한다", () => {
    const diff = makeDiff({
      projects: [
        { name: "proj", before: {} as any, after: {} as any,
          status: "changed", progressChange: 5, readinessChange: 0, activityChange: 0 },
      ],
    });
    expect(WebhookNotifier.shouldNotify(diff)).toBe(true);
  });

  it("진행률 변화가 5%p 미만이고 추가/삭제 없으면 false를 반환한다", () => {
    const diff = makeDiff({
      projects: [
        { name: "proj", before: {} as any, after: {} as any,
          status: "changed", progressChange: 4, readinessChange: 0, activityChange: 0 },
      ],
    });
    expect(WebhookNotifier.shouldNotify(diff)).toBe(false);
  });

  it("변경이 없으면 false를 반환한다", () => {
    const diff = makeDiff();
    expect(WebhookNotifier.shouldNotify(diff)).toBe(false);
  });
});

describe("WebhookNotifier.notify", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("올바른 URL과 payload로 fetch POST를 호출한다", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const notifier = new WebhookNotifier("https://example.com/hook");
    const payload = {
      scannedAt: "2026-01-01T00:00:00.000Z",
      summary: { total: 1, active: 1, avgProgress: 50 as number | null, avgReadiness: 60 },
      changes: { added: ["proj-a"], removed: [] as string[], changed: [] as never[] },
    };

    await notifier.notify(payload);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith("https://example.com/hook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  it("fetch 실패 시 오류를 throw한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const notifier = new WebhookNotifier("https://example.com/hook");
    await expect(
      notifier.notify({
        scannedAt: "2026-01-01T00:00:00.000Z",
        summary: { total: 0, active: 0, avgProgress: null, avgReadiness: 0 },
        changes: { added: [], removed: [], changed: [] },
      }),
    ).rejects.toThrow("network error");
  });
});
