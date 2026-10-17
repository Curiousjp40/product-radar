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
 * (everything further out). Already-passed events are dropped. Pure so
 * it's testable without a clock mock baked into the DOM render. */
export type SeasonTimelineGroup = "ahora" | "proximo" | "mas_adelante";

export function groupSeasonEvents(events: SeasonEvent[], today: Date = new Date()): Record<SeasonTimelineGroup, SeasonEvent[]> {
  const todayIso = today.toISOString().slice(0, 10);
  const active: SeasonEvent[] = [];
  const upcoming: SeasonEvent[] = [];
  for (const ev of events) {
    if (ev.film_start && ev.film_end) {
      if (ev.film_end < todayIso) continue; // already passed
      if (ev.film_start <= todayIso) {
        active.push(ev);
        continue;
      }
    }
    upcoming.push(ev);
  }
  const sortKey = (ev: SeasonEvent): string => ev.film_start ?? ev.event_date ?? "9999-99-99";
  upcoming.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return {
    ahora: active,
    proximo: upcoming.slice(0, 1),
    mas_adelante: upcoming.slice(1),
  };
}
