import { t, type Lang } from "./i18n";
import type { BestVideoTime } from "./types";

const WEEKDAY_KEYS = ["weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri", "weekday_sat", "weekday_sun"];

function formatHourRange(hourStart: number, hourEnd: number, lang: Lang): string {
  const to12 = (h: number) => (h % 12 === 0 ? 12 : h % 12);
  const period = (h: number) => (h < 12 ? "AM" : "PM");
  const startPeriod = period(hourStart);
  const endPeriod = period(hourEnd);
  const range =
    startPeriod === endPeriod
      ? `${to12(hourStart)}-${to12(hourEnd)} ${startPeriod}`
      : `${to12(hourStart)} ${startPeriod} - ${to12(hourEnd)} ${endPeriod}`;
  void lang;
  return range;
}

function weekdaysLabel(days: number[], lang: Lang): string {
  return days.map((d) => t(WEEKDAY_KEYS[d], lang)).join(" / ");
}

function basisLabel(bvt: BestVideoTime, lang: Lang): string {
  const key = bvt.used_organic_only ? "best_time_basis_organic" : "best_time_basis_all";
  const levelKey = `best_time_level_${bvt.basis_level}`;
  return t(key, lang, { n: bvt.sample_size, level: t(levelKey, lang) });
}

/** Part C7a: "Mejor hora para grabar y publicar" line + its basis, shown on
 * Hoy/Esta semana cards and the product page. Never blank -- bvt is only
 * null when there isn't a single video anywhere in the pool yet. */
export function bestVideoTimeHtml(bvt: BestVideoTime | null, lang: Lang): string {
  if (!bvt) return `<p class="best-time-line best-time-unavailable">${t("best_time_video_unavailable", lang)}</p>`;
  const window = formatHourRange(bvt.hour_start, bvt.hour_end, lang);
  const days = weekdaysLabel(bvt.best_weekdays, lang);
  return `
    <p class="best-time-line">
      <strong>${t("best_time_video_label", lang)}:</strong> ${days} ${window}
    </p>
    <p class="best-time-basis">${basisLabel(bvt, lang)}</p>
  `;
}
