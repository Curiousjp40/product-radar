import { loadBestTimes, loadCandidates } from "../api";
import { t, type Lang } from "../i18n";
import type { CategoryGroupBestTime, LiveBestTime } from "../types";
import { videoSubTabsHtml } from "../videoSubTabs";

const WEEKDAY_KEYS = ["weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri", "weekday_sat", "weekday_sun"];

function formatHourRange(hourStart: number, hourEnd: number): string {
  const to12 = (h: number) => (h % 12 === 0 ? 12 : h % 12);
  const period = (h: number) => (h < 12 ? "AM" : "PM");
  const startPeriod = period(hourStart);
  const endPeriod = period(hourEnd);
  if (startPeriod === endPeriod) return `${to12(hourStart)}-${to12(hourEnd)} ${startPeriod}`;
  return `${to12(hourStart)} ${startPeriod} - ${to12(hourEnd)} ${endPeriod}`;
}

function rowHtml(label: string, bt: CategoryGroupBestTime | null, lang: Lang): string {
  if (!bt) {
    return `<div class="best-times-row"><div class="best-times-row-label">${label}</div><p class="empty-state" style="padding:2px 0">${t("best_time_video_unavailable", lang)}</p></div>`;
  }
  const days = bt.best_weekdays.map((d) => t(WEEKDAY_KEYS[d], lang)).join(" / ");
  const basis = bt.used_organic_only
    ? t("best_time_basis_organic", lang, { n: bt.sample_size, level: label })
    : t("best_time_basis_all", lang, { n: bt.sample_size, level: label });
  return `
    <div class="best-times-row">
      <div class="best-times-row-label">${label}</div>
      <div class="best-times-row-value">${days} ${formatHourRange(bt.hour_start, bt.hour_end)}</div>
      <div class="best-times-row-basis">${basis}</div>
    </div>
  `;
}

function liveRowHtml(label: string, lt: LiveBestTime | null, lang: Lang): string {
  if (!lt) {
    return `<div class="best-times-row"><div class="best-times-row-label">${label}</div><p class="empty-state" style="padding:2px 0">${t("best_time_video_unavailable", lang)}</p></div>`;
  }
  const days = lt.best_weekdays.map((d) => t(WEEKDAY_KEYS[d], lang)).join(" / ");
  const basis = t("mejores_horas_live_sample_note", lang, { n: lt.sample_size, level: label });
  return `
    <div class="best-times-row">
      <div class="best-times-row-label">${label}</div>
      <div class="best-times-row-value">${days} ${formatHourRange(lt.hour_start, lt.hour_end)}</div>
      <div class="best-times-row-basis">${basis}</div>
      ${lt.median_duration_minutes !== null ? `<div class="best-times-row-basis">${t("mejores_horas_live_duration_note", lang, { n: lt.median_duration_minutes })}</div>` : ""}
    </div>
  `;
}

export async function renderMejoresHoras(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const [{ data: bestTimes }, { data: candidatesData }] = await Promise.all([loadBestTimes(), loadCandidates()]);

  const categoryLabel = (cat: string): string => {
    const sample = candidatesData.candidates.find((c) => c.category === cat);
    return sample ? (lang === "es" ? sample.category_label_es : sample.category_label_en) : cat;
  };
  const groupLabel = (group: string): string => t(group === "home" ? "group_home" : "group_fashion", lang);

  const categoryEntries = Object.entries(bestTimes.categories).sort(([a], [b]) => categoryLabel(a).localeCompare(categoryLabel(b)));
  const groupEntries = Object.entries(bestTimes.groups);
  const liveEntries = Object.entries(bestTimes.live ?? {}).sort(([a], [b]) => categoryLabel(a).localeCompare(categoryLabel(b)));

  container.innerHTML = `
    ${videoSubTabsHtml("mejores-horas", lang)}
    <h2 class="view-title">${t("mejores_horas_title", lang)}</h2>
    <p class="best-times-intro">${t("mejores_horas_intro", lang)}</p>

    <h3 class="view-subtitle">${t("mejores_horas_by_group", lang)}</h3>
    <div class="best-times-list">${groupEntries.map(([group, bt]) => rowHtml(groupLabel(group), bt, lang)).join("")}</div>

    <h3 class="view-subtitle">${t("mejores_horas_by_category", lang)}</h3>
    <div class="best-times-list">${categoryEntries.map(([cat, bt]) => rowHtml(categoryLabel(cat), bt, lang)).join("")}</div>

    <h3 class="view-subtitle">${t("mejores_horas_live_title", lang)}</h3>
    ${
      liveEntries.length > 0
        ? `<div class="best-times-list">${liveEntries.map(([cat, lt]) => liveRowHtml(categoryLabel(cat), lt, lang)).join("")}</div>`
        : `<p class="empty-state">${t("best_time_video_unavailable", lang)}</p>`
    }
    <p class="best-times-footnote">${t("mejores_horas_ari_note", lang)}</p>

    <p class="best-times-footnote">
      ${t("mejores_horas_footnote", lang)}
      <a href="https://www.tiktok.com/analytics" target="_blank" rel="noopener">${t("mejores_horas_tiktok_studio_link", lang)}</a>
    </p>
  `;
}
