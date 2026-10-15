import { loadSeasons } from "../api";
import { t, type Lang } from "../i18n";
import type { SeasonEvent } from "../types";

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr + "T00:00:00Z").getTime();
  const now = Date.now();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

function countdownText(ev: SeasonEvent, lang: Lang): string {
  if (!ev.film_start || !ev.film_end) {
    return t("season_dates_tbd", lang);
  }
  const toStart = daysUntil(ev.film_start);
  const toEnd = daysUntil(ev.film_end);
  if (toEnd !== null && toEnd < 0) {
    return t("season_already_passed", lang);
  }
  if (toStart !== null && toStart <= 0 && toEnd !== null) {
    return t("season_window_open", lang, { days: toEnd });
  }
  return t("season_starts_in", lang, { days: toStart ?? 0 });
}

export async function renderSeason(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const { data, isSample } = await loadSeasons();
  const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";

  const sorted = [...data.events].sort((a, b) => {
    const da = daysUntil(a.film_end) ?? Infinity;
    const db = daysUntil(b.film_end) ?? Infinity;
    return da - db;
  });

  container.innerHTML = `
    ${banner}
    <h2 class="view-title">${t("season_title", lang)}</h2>
    ${sorted
      .map(
        (ev) => `
      <div class="season-card">
        <h3 style="margin:0 0 4px">${lang === "es" ? ev.label_es : ev.label_en}</h3>
        <div class="countdown">${countdownText(ev, lang)}</div>
        <div style="margin-top:6px;font-size:0.78rem;color:var(--text-dim)">${ev.categories.join(", ")}</div>
        ${ev.film_start && ev.film_end ? `<div style="font-size:0.75rem;color:var(--text-dim)">${ev.film_start} -> ${ev.film_end}</div>` : ""}
      </div>`,
      )
      .join("")}
  `;
}
