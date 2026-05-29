import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROGRESS_CHANGE_THRESHOLD,
  hasMeaningfulNotificationChange,
  resolveProgressChangeThreshold,
} from "./NotificationPolicy.js";
import type { ScanDiff } from "./TrendAnalyzer.js";

describe("NotificationPolicy", () => {
  it("resolves invalid progress thresholds to the default", () => {
    expect(resolveProgressChangeThreshold()).toBe(
      DEFAULT_PROGRESS_CHANGE_THRESHOLD,
    );
    expect(
      resolveProgressChangeThreshold({ progressChangeThreshold: -1 }),
    ).toBe(DEFAULT_PROGRESS_CHANGE_THRESHOLD);
    expect(
      resolveProgressChangeThreshold({ progressChangeThreshold: Number.NaN }),
    ).toBe(DEFAULT_PROGRESS_CHANGE_THRESHOLD);
  });

  it("does not treat zero progress change as meaningful when threshold is zero", () => {
    expect(
      hasMeaningfulNotificationChange(makeDiff(0), {
        progressChangeThreshold: 0,
      }),
    ).toBe(false);
    expect(
      hasMeaningfulNotificationChange(makeDiff(1), {
        progressChangeThreshold: 0,
      }),
    ).toBe(true);
  });
});

function makeDiff(progressChange: number): ScanDiff {
  return {
    fromDate: new Date("2026-01-01T00:00:00.000Z"),
    toDate: new Date("2026-01-02T00:00:00.000Z"),
    summary: {
      before: {
        total: 1,
        active: 1,
        avgProgress: 50,
        avgReadiness: 50,
        byPriority: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0 },
        byType: {
          node: 1,
          python: 0,
          dart: 0,
          java: 0,
          kotlin: 0,
          go: 0,
          rust: 0,
          unknown: 0,
        },
      },
      after: {
        total: 1,
        active: 1,
        avgProgress: 50 + progressChange,
        avgReadiness: 50,
        byPriority: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0 },
        byType: {
          node: 1,
          python: 0,
          dart: 0,
          java: 0,
          kotlin: 0,
          go: 0,
          rust: 0,
          unknown: 0,
        },
      },
      changes: {
        total: 0,
        active: 0,
        avgProgress: progressChange,
        avgReadiness: 0,
      },
    },
    projects: [
      {
        name: "project",
        before: null,
        after: null,
        status: "changed",
        progressChange,
        readinessChange: 0,
        activityChange: 0,
      },
    ],
  };
}
