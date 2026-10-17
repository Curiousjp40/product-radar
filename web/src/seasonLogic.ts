import type { SeasonEvent } from "./types";

export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr + "T00:00:00Z").getTime();
  const now = Date.now();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

/** Pure (no i18n dependency, same convention as the other *Logic.ts
 * modules) -- the view layer maps `kind` to the right translated string. */
export type CountdownStatus =
  | { kind: "tbd" }
  | { kind: "already_passed" }
  | { kind: "window_open"; days: number }
  | { kind: "starts_in"; days: number };

export function countdownStatus(ev: SeasonEvent): CountdownStatus {
  if (!ev.film_start || !ev.film_end) {
    return { kind: "tbd" };
  }
  const toStart = daysUntil(ev.film_start);
  const toEnd = daysUntil(ev.film_end);
  if (toEnd !== null && toEnd < 0) {
    return { kind: "already_passed" };
  }
  if (toStart !== null && toStart <= 0 && toEnd !== null) {
    return { kind: "window_open", days: toEnd };
  }
  // Design review section 0 item 8 / Ryan's dates fix: count down to the
  // real recognized day (event_date), not film_end -- film_end is
  // deliberately later (keep posting through Cyber Monday), so counting
  // down to it understated "days until Black Friday" by several days.
  const anchor = ev.event_date ?? ev.film_end;
  const toAnchor = daysUntil(anchor);
  return { kind: "starts_in", days: toAnchor ?? toStart ?? 0 };
}

/** Design review 3.13 timeline grouping: "Ahora" (currently in her film
 * window), "Próximo" (the single nearest upcoming event), "Más adelante"
 * (everything further out), "Pasadas" (the event day -- event_date, or
 * film_end when there's no single day -- has already happened; collapsed
 * out of the main timeline per Ryan's redesign ask). Pure so it's
 * testable without a clock mock baked into the DOM render. */
export type SeasonTimelineGroup = "ahora" | "proximo" | "mas_adelante" | "pasadas";

export function groupSeasonEvents(events: SeasonEvent[], today: Date = new Date()): Record<SeasonTimelineGroup, SeasonEvent[]> {
  const todayIso = today.toISOString().slice(0, 10);
  const active: SeasonEvent[] = [];
  const upcoming: SeasonEvent[] = [];
  const past: SeasonEvent[] = [];
  for (const ev of events) {
    const endAnchor = ev.event_date ?? ev.film_end;
    if (endAnchor && endAnchor < todayIso) {
      past.push(ev);
      continue;
    }
    if (ev.film_start && ev.film_end) {
      if (ev.film_start <= todayIso) {
        active.push(ev);
        continue;
      }
    }
    upcoming.push(ev);
  }
  const sortKey = (ev: SeasonEvent): string => ev.film_start ?? ev.event_date ?? "9999-99-99";
  upcoming.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  past.sort((a, b) => sortKey(b).localeCompare(sortKey(a))); // most-recently-passed first
  return {
    ahora: active,
    proximo: upcoming.slice(0, 1),
    mas_adelante: upcoming.slice(1),
    pasadas: past,
  };
}

/** 0-100 position of "today" between film_start and the event's real end
 * anchor (event_date, or film_end when there's no single day) -- drives
 * the hero's progress bar. Clamped; null inputs or a zero-length window
 * return null (caller hides the bar). */
export function progressFraction(filmStart: string | null, anchor: string | null, today: Date = new Date()): number | null {
  if (!filmStart || !anchor) return null;
  const start = new Date(filmStart + "T00:00:00Z").getTime();
  const end = new Date(anchor + "T00:00:00Z").getTime();
  const now = today.getTime();
  if (end <= start) return null;
  const pct = ((now - start) / (end - start)) * 100;
  return Math.max(0, Math.min(100, pct));
}

/** Design review item 5: never show "seasonal"/"other" (meta categories,
 * not real FastMoss ones) in an event's category list, and cap to the
 * `max` most relevant (BFCM touches ~11 real categories -- showing all of
 * them obscures which ones actually matter for that event). */
export function displayCategories(categories: string[], max = 4): string[] {
  return categories.filter((c) => c !== "seasonal" && c !== "other").slice(0, max);
}

/** A stable "kind" for theming -- event ids carry a year suffix that
 * changes annually (halloween_2026, valentines_2027, ...), so the theme
 * lookup keys off the id with that suffix stripped. */
export function eventKind(id: string): string {
  return id.replace(/_\d{4}$/, "");
}

/** Month index (0-based, continuous across years: Jan 2027 = 12) relative
 * to `baseYear`/`baseMonth0` (also 0-based) -- the building block for the
 * timeline's horizontal month strip. */
function monthOffset(dateStr: string, baseYear: number, baseMonth0: number): number {
  const d = new Date(dateStr + "T00:00:00Z");
  return (d.getUTCFullYear() - baseYear) * 12 + (d.getUTCMonth() - baseMonth0);
}

export interface TimelineSpan {
  startCol: number; // 1-based CSS grid-column, clamped to the visible range
  span: number; // >=1
  visible: boolean;
}

/** Where an event's bar sits in a `monthCount`-month strip starting at
 * (baseYear, baseMonth0). Uses event_date (falling back to film_end) as
 * the bar's end when there's no film_start/film_end window at all, so a
 * TBD event with only a guess date still shows as a single-month dot
 * rather than vanishing. Returns visible:false when the event falls
 * entirely outside the strip. */
export function timelineSpan(ev: SeasonEvent, baseYear: number, baseMonth0: number, monthCount = 12): TimelineSpan {
  const startStr = ev.film_start ?? ev.event_date ?? ev.film_end;
  const endStr = ev.film_end ?? ev.event_date ?? ev.film_start;
  if (!startStr || !endStr) return { startCol: 1, span: 1, visible: false };
  const startOffset = monthOffset(startStr, baseYear, baseMonth0);
  const endOffset = monthOffset(endStr, baseYear, baseMonth0);
  const lo = Math.min(startOffset, endOffset);
  const hi = Math.max(startOffset, endOffset);
  if (hi < 0 || lo >= monthCount) return { startCol: 1, span: 1, visible: false };
  const clampedLo = Math.max(0, lo);
  const clampedHi = Math.min(monthCount - 1, hi);
  return { startCol: clampedLo + 1, span: clampedHi - clampedLo + 1, visible: true };
}
