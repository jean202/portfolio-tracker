import { InvalidArgumentError } from "commander";
import { describe, expect, it } from "vitest";
import {
  parseDurationOption,
  parseNonNegativeNumber,
  parsePercent,
  parsePositiveInt,
} from "./options.js";

describe("CLI option parsers", () => {
  it("parsePositiveInt accepts positive integers only", () => {
    expect(parsePositiveInt("3")).toBe(3);
    expect(parsePositiveInt(" 12 ")).toBe(12);
    for (const bad of ["abc", "0", "-1", "1.5", "3x", "", "1e3"]) {
      expect(() => parsePositiveInt(bad)).toThrow(InvalidArgumentError);
    }
  });

  it("parsePercent accepts integers between 0 and 100", () => {
    expect(parsePercent("0")).toBe(0);
    expect(parsePercent("100")).toBe(100);
    for (const bad of ["abc", "101", "-5", "50%", ""]) {
      expect(() => parsePercent(bad)).toThrow(InvalidArgumentError);
    }
  });

  it("parseNonNegativeNumber accepts zero and decimals", () => {
    expect(parseNonNegativeNumber("0")).toBe(0);
    expect(parseNonNegativeNumber("1.5")).toBe(1.5);
    for (const bad of ["abc", "-1", ""]) {
      expect(() => parseNonNegativeNumber(bad)).toThrow(InvalidArgumentError);
    }
  });

  it("parseDurationOption returns milliseconds or a friendly error", () => {
    expect(parseDurationOption("30m")).toBe(30 * 60 * 1000);
    expect(() => parseDurationOption("5x")).toThrow(InvalidArgumentError);
    expect(() => parseDurationOption("5x")).toThrow(/예: 30m, 2h, 1d/);
  });
});
