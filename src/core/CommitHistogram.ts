/**
 * Per-day commit counts over a trailing window, for the activity heatmap.
 * Keys are local calendar days "YYYY-MM-DD"; days with no commits are omitted.
 */
export function buildCommitHistogram(
  commitDates: Date[],
  now: Date,
  days = 91,
): Record<string, number> {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();
  const out: Record<string, number> = {};
  for (const d of commitDates) {
    const t = d.getTime();
    if (Number.isNaN(t)) continue;
    if (t < cutoff || t > nowMs) continue; // inside window, not future
    const key = localDayKey(d);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
