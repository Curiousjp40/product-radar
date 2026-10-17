import { t, type Lang } from "../i18n";
import type { CategoryGroupBestTime, HeatGridCell, LiveBestTime } from "../types";
import { aggregateByHour, aggregateByWeekday, bestBarIndex, type Bar } from "../scheduleBars";

const WEEKDAY_KEYS = ["weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri", "weekday_sat", "weekday_sun"];
export const HOUR_BLOCKS = Array.from({ length: 12 }, (_, i) => i * 2);

function formatHourRange(hourStart: number, hourEnd: number): string {
  const to12 = (h: number) => (h % 12 === 0 ? 12 : h % 12);
  const period = (h: number) => (h < 12 ? "AM" : "PM");
  const startPeriod = period(hourStart);
  const endPeriod = period(hourEnd % 24);
  if (startPeriod === endPeriod) return `${to12(hourStart)}-${to12(hourEnd % 24)} ${startPeriod}`;
  return `${to12(hourStart)} ${startPeriod} - ${to12(hourEnd % 24)} ${endPeriod}`;
}

function weekdayLabel(weekday: number, lang: Lang): string {
  return t(WEEKDAY_KEYS[weekday], lang);
}

/** Design review 3.4/3.7: "lead every data screen with the answer in
 * words, then the chart." `bt` is either a video or live best-time
 * summary (same shape); `kind` only changes wording. */
export function answerCardHtml(bt: CategoryGroupBestTime | LiveBestTime | null, categoryLabel: string, lang: Lang, kind: "video" | "live"): string {
  if (!bt || bt.best_weekdays.length === 0) {
    return `<p class="empty-state">${t("best_time_video_unavailable", lang)}</p>`;
  }
  const window = formatHourRange(bt.hour_start, bt.hour_end);
  const headline = t(kind === "live" ? "answer_card_live_headline" : "answer_card_video_headline", lang, {
    category: categoryLabel,
    days: weekdayLabel(bt.best_weekdays[0], lang),
    window,
  });
  const reason = t(kind === "live" ? "answer_card_reason_live" : "answer_card_reason", lang);
  const second = bt.best_weekdays.length > 1 ? `<p class="answer-card-second">${t("answer_card_second_option", lang, { days: weekdayLabel(bt.best_weekdays[1], lang), window })}</p>` : "";
  const duration = "median_duration_minutes" in bt && bt.median_duration_minutes !== null ? `<p class="answer-card-meta">${t("mejores_horas_live_duration_note", lang, { n: bt.median_duration_minutes })}</p>` : "";
  const lowSample = bt.sample_size < 30 ? `<p class="answer-card-low-sample">${t("answer_card_low_sample", lang)}</p>` : "";
  return `
    <div class="answer-card">
      <p class="answer-card-headline">${headline}</p>
      <p class="answer-card-reason">${reason}</p>
      ${second}
      ${duration}
      ${lowSample}
    </div>
  `;
}

function barsHtml(bars: Bar[], labels: string[], bestIdx: number | null, lang: Lang): string {
  const maxValue = bars.reduce((max, b) => Math.max(max, b.value), 0);
  return `
    <div class="bar-chart">
      ${bars
        .map((b, i) => {
          const heightPct = maxValue > 0 ? Math.max(4, Math.round((b.value / maxValue) * 100)) : 0;
          const hasData = b.sampleSize >= 3;
          return `
          <div class="bar-chart-col">
            <div class="bar-chart-value">${hasData ? b.value : ""}</div>
            <div class="bar-chart-bar${i === bestIdx ? " best" : ""}${!hasData ? " no-data" : ""}" style="--height:${hasData ? heightPct : 6}%"></div>
            <div class="bar-chart-label">${labels[i]}</div>
          </div>
        `;
        })
        .join("")}
    </div>
    ${bars.every((b) => b.sampleSize < 3) ? `<p class="empty-state bar-chart-empty">${t("bar_chart_no_data", lang)}</p>` : ""}
  `;
}

export function dayBarChartHtml(cells: HeatGridCell[], lang: Lang): string {
  const bars = aggregateByWeekday(cells);
  const bestIdx = bestBarIndex(bars);
  const labels = bars.map((b) => weekdayLabel(b.weekday, lang));
  return `
    <div class="bar-chart-section">
      <h4>${t("bar_chart_by_day_title", lang)}</h4>
      ${barsHtml(bars, labels, bestIdx, lang)}
      <p class="bar-chart-caption">${t("bar_chart_by_day_caption", lang)}</p>
    </div>
  `;
}

export function hourBarChartHtml(cells: HeatGridCell[], lang: Lang): string {
  const bars = aggregateByHour(cells, HOUR_BLOCKS);
  const bestIdx = bestBarIndex(bars);
  const labels = HOUR_BLOCKS.map((h) => formatHourRange(h, h + 2));
  return `
    <div class="bar-chart-section">
      <h4>${t("bar_chart_by_hour_title", lang)}</h4>
      ${barsHtml(bars, labels, bestIdx, lang)}
      <p class="bar-chart-caption">${t("bar_chart_by_hour_caption", lang)}</p>
    </div>
  `;
}
