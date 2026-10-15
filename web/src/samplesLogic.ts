/** Part D (added 2026-10-15): pure logic for the sample tracker -- urgency,
 * sorting, the tax-season yearly total, CSV export, and the Hoy-page
 * overdue banner. All localStorage I/O lives in samples.ts; this file has
 * no DOM/storage access so it's plain-testable (see web/test/samplesLogic.
 * test.ts, Node's native --experimental-strip-types, no new dependency --
 * same approach as rotation.ts). */

export type SampleStatus = "received" | "filmed" | "posted";

export interface Sample {
  id: string;
  product_id?: string;
  name: string;
  date_received: string; // ISO YYYY-MM-DD
  value_usd: number;
  post_by_date: string; // ISO YYYY-MM-DD
  notes: string;
  status: SampleStatus;
  tiktok_url?: string; // only meaningful once status === "posted"
}

export function defaultPostByDate(dateReceivedIso: string, daysToAdd = 14): string {
  const d = new Date(`${dateReceivedIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + daysToAdd);
  return d.toISOString().slice(0, 10);
}

/** Positive = days remaining, 0 = due today, negative = days overdue. */
export function daysUntilPostBy(postByIso: string, today: Date): number {
  const target = new Date(`${postByIso}T00:00:00Z`).getTime();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - todayUtc) / 86_400_000);
}

export type Urgency = "overdue" | "due_soon" | "ok" | "posted";

/** "due_soon" = within 3 days of post_by_date, not yet posted -- the
 * Muestras list's own orange/red banding. The Hoy-page banner uses a
 * stricter, separately-configurable threshold (see hasUrgentSamples). */
export function sampleUrgency(sample: Sample, today: Date, dueSoonDays = 3): Urgency {
  if (sample.status === "posted") return "posted";
  const days = daysUntilPostBy(sample.post_by_date, today);
  if (days < 0) return "overdue";
  if (days <= dueSoonDays) return "due_soon";
  return "ok";
}

const URGENCY_RANK: Record<Urgency, number> = { overdue: 0, due_soon: 1, ok: 2, posted: 3 };

/** Most urgent first: overdue, then due-soon-to-ok by days remaining
 * (ascending), posted samples last regardless of date. */
export function sortSamplesByUrgency(samples: Sample[], today: Date): Sample[] {
  return [...samples].sort((a, b) => {
    const ua = sampleUrgency(a, today);
    const ub = sampleUrgency(b, today);
    if (URGENCY_RANK[ua] !== URGENCY_RANK[ub]) return URGENCY_RANK[ua] - URGENCY_RANK[ub];
    return daysUntilPostBy(a.post_by_date, today) - daysUntilPostBy(b.post_by_date, today);
  });
}

export interface SamplesSummary {
  pending: number;
  overdue: number;
  totalValueThisYear: number;
}

/** "Pendientes" = anything not yet posted (received or filmed); "vencidas"
 * = past post_by_date and not posted; the yearly total is every sample
 * *received* in `today`'s calendar year, posted or not -- it's a tax
 * record of value received, not of content delivered. */
export function samplesSummary(samples: Sample[], today: Date): SamplesSummary {
  const year = today.getUTCFullYear();
  let pending = 0;
  let overdue = 0;
  let totalValueThisYear = 0;
  for (const s of samples) {
    if (s.status !== "posted") pending += 1;
    if (sampleUrgency(s, today) === "overdue") overdue += 1;
    if (new Date(`${s.date_received}T00:00:00Z`).getUTCFullYear() === year) totalValueThisYear += s.value_usd;
  }
  return { pending, overdue, totalValueThisYear };
}

/** Hoy page's own banner trigger -- deliberately a tighter window (2 days)
 * than the Muestras list's own 3-day "due_soon" highlight; the task brief
 * specifies both numbers separately, not as the same threshold reused. */
export function hasUrgentSamples(samples: Sample[], today: Date, bannerThresholdDays = 2): boolean {
  return samples.some((s) => {
    if (s.status === "posted") return false;
    const days = daysUntilPostBy(s.post_by_date, today);
    return days <= bannerThresholdDays;
  });
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function samplesToCsv(samples: Sample[]): string {
  const header = ["name", "date_received", "value_usd", "post_by_date", "status", "tiktok_url", "notes"];
  const rows = samples.map((s) =>
    [s.name, s.date_received, String(s.value_usd), s.post_by_date, s.status, s.tiktok_url ?? "", s.notes]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}
