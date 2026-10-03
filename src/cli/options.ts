import { InvalidArgumentError } from "commander";
import { parseDuration } from "../core/Interval.js";

// commander argParser용 검증 함수들.
// InvalidArgumentError를 던지면 commander가 스택 없이
// "error: option '-n, --count <count>' argument 'abc' is invalid. ..." 형태로
// 안내하고 종료 코드 1로 끝냅니다.

const INTEGER_PATTERN = /^\d+$/;

export function parsePositiveInt(value: string): number {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (
    !INTEGER_PATTERN.test(trimmed) ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1
  ) {
    throw new InvalidArgumentError("1 이상의 정수여야 합니다.");
  }
  return parsed;
}

export function parsePercent(value: string): number {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (!INTEGER_PATTERN.test(trimmed) || parsed > 100) {
    throw new InvalidArgumentError("0에서 100 사이의 정수여야 합니다.");
  }
  return parsed;
}

export function parseNonNegativeNumber(value: string): number {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (trimmed === "" || !Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError("0 이상의 숫자여야 합니다.");
  }
  return parsed;
}

export function parseDurationOption(value: string): number {
  try {
    return parseDuration(value);
  } catch {
    throw new InvalidArgumentError(
      "숫자 뒤에 단위(ms, s, m, h, d)를 붙여 주세요. 예: 30m, 2h, 1d",
    );
  }
}

export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
