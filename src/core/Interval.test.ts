import { describe, expect, it } from "vitest";
import { formatDuration, parseDuration } from "./Interval.js";

describe("parseDuration", () => {
  it("parses common duration units", () => {
    expect(parseDuration("500")).toBe(500);
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("15s")).toBe(15_000);
    expect(parseDuration("30m")).toBe(1_800_000);
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(parseDuration("1d")).toBe(86_400_000);
  });

  it("rejects invalid durations", () => {
    expect(() => parseDuration("")).toThrow();
    expect(() => parseDuration("0m")).toThrow();
    expect(() => parseDuration("-1m")).toThrow();
    expect(() => parseDuration("abc")).toThrow();
  });
});

describe("formatDuration", () => {
  it("formats milliseconds with the largest exact unit", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(15_000)).toBe("15s");
    expect(formatDuration(1_800_000)).toBe("30m");
    expect(formatDuration(7_200_000)).toBe("2h");
    expect(formatDuration(86_400_000)).toBe("1d");
  });
});
