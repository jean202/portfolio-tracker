const DURATION_PATTERN = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/i;

const UNIT_TO_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function parseDuration(value: string): number {
  const normalized = value.trim();
  const match = normalized.match(DURATION_PATTERN);

  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? "ms").toLowerCase();
  const milliseconds = amount * UNIT_TO_MS[unit];

  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new Error(`Invalid duration: ${value}`);
  }

  return Math.round(milliseconds);
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds % UNIT_TO_MS.d === 0)
    return `${milliseconds / UNIT_TO_MS.d}d`;
  if (milliseconds % UNIT_TO_MS.h === 0)
    return `${milliseconds / UNIT_TO_MS.h}h`;
  if (milliseconds % UNIT_TO_MS.m === 0)
    return `${milliseconds / UNIT_TO_MS.m}m`;
  if (milliseconds % UNIT_TO_MS.s === 0)
    return `${milliseconds / UNIT_TO_MS.s}s`;
  return `${milliseconds}ms`;
}
