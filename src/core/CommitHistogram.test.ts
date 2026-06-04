import { describe, it, expect } from "vitest";
import { buildCommitHistogram } from "./CommitHistogram";

describe("buildCommitHistogram", () => {
  const now = new Date(2026, 5, 4, 12, 0, 0); // 2026-06-04 local noon

  it("groups multiple commits on the same local day", () => {
    const h = buildCommitHistogram(
      [new Date(2026, 5, 4, 9), new Date(2026, 5, 4, 10)],
      now,
    );
    expect(h["2026-06-04"]).toBe(2);
  });

  it("keeps different days separate", () => {
    const h = buildCommitHistogram(
      [new Date(2026, 5, 4), new Date(2026, 5, 3)],
      now,
    );
    expect(h["2026-06-04"]).toBe(1);
    expect(h["2026-06-03"]).toBe(1);
  });

  it("excludes commits older than the window", () => {
    const old = new Date(now.getTime() - 92 * 24 * 60 * 60 * 1000);
    const h = buildCommitHistogram([old], now, 91);
    expect(Object.keys(h)).toHaveLength(0);
  });

  it("excludes future commits", () => {
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const h = buildCommitHistogram([future], now);
    expect(Object.keys(h)).toHaveLength(0);
  });

  it("skips invalid dates and returns {} for empty input", () => {
    expect(buildCommitHistogram([], now)).toEqual({});
    expect(buildCommitHistogram([new Date("nope")], now)).toEqual({});
  });
});
