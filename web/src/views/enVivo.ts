import { loadBestTimes, loadCandidates, loadLiveHighlights, loadPicks } from "../api";
import { t, type Lang } from "../i18n";
import { buildLivePlan, type LivePlanProduct } from "../livePlan";
import { getAllMisProductos, type MisProducto } from "../misProductos";
import type { LiveHighlight, LiveBestTime } from "../types";

const WEEKDAY_KEYS = ["weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri", "weekday_sat", "weekday_sun"];

function formatHourRange(hourStart: number, hourEnd: number): string {
  const to12 = (h: number) => (h % 12 === 0 ? 12 : h % 12);
  const period = (h: number) => (h < 12 ? "AM" : "PM");
  const startPeriod = period(hourStart);
  const endPeriod = period(hourEnd);
  if (startPeriod === endPeriod) return `${to12(hourStart)}-${to12(hourEnd)} ${startPeriod}`;
  return `${to12(hourStart)} ${startPeriod} - ${to12(hourEnd)} ${endPeriod}`;
}

function liveTimeRowHtml(label: string, lt: LiveBestTime, lang: Lang): string {
  const days = lt.best_weekdays.map((d) => t(WEEKDAY_KEYS[d], lang)).join(" / ");
  return `
    <div class="best-times-row">
      <div class="best-times-row-label">${label}</div>
      <div class="best-times-row-value">${days} ${formatHourRange(lt.hour_start, lt.hour_end)}</div>
      <div class="best-times-row-basis">${t("mejores_horas_live_sample_note", lang, { n: lt.sample_size, level: label })}</div>
      ${lt.median_duration_minutes !== null ? `<div class="best-times-row-basis">${t("mejores_horas_live_duration_note", lang, { n: lt.median_duration_minutes })}</div>` : ""}
    </div>
  `;
}

function formatTime(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(lang === "es" ? "es-MX" : "en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function highlightRowHtml(h: LiveHighlight, lang: Lang): string {
  return `
    <div class="live-highlight-row">
      <div class="live-highlight-title">${h.title || "@" + h.creator_handle}</div>
      <div class="meta">${formatTime(h.started_at, lang)} &middot; ${h.duration_minutes} min</div>
      <div class="meta">${t("en_vivo_highlight_stats", lang, { viewers: h.viewer_count, units: h.units_sold })}</div>
    </div>
  `;
}

function planProductRowHtml(p: LivePlanProduct, lang: Lang): string {
  return `
    <div class="live-plan-product">
      <div class="name">${p.name}</div>
      <div class="meta">${t("earn_headline", lang, { amount: p.earnings_per_sale.toFixed(2) })}</div>
      ${p.talking_point ? `<p class="live-plan-talking-point">${p.talking_point}</p>` : ""}
    </div>
  `;
}

function readyToFilm(item: MisProducto): boolean {
  return item.status === "recibido" || item.status === "grabado";
}

export async function renderEnVivo(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const [{ data: bestTimes }, { data: liveHighlights }, { data: picksData }, { data: candidatesData }, misProductos] = await Promise.all([
    loadBestTimes(),
    loadLiveHighlights(),
    loadPicks(),
    loadCandidates(),
    getAllMisProductos(),
  ]);

  const liveEntries = Object.entries(bestTimes.live ?? {}).filter((e): e is [string, LiveBestTime] => e[1] !== null);
  const categoryLabel = (cat: string): string => {
    const c = candidatesData.candidates.find((c) => c.category === cat);
    if (c) return lang === "es" ? c.category_label_es : c.category_label_en;
    // Seasonal categories outside their active window (e.g. pajamas in
    // October) have no candidates to pull a label from -- fall back to a
    // readable version of the key rather than the raw "pajamas".
    return cat.charAt(0).toUpperCase() + cat.slice(1).replaceAll("_", " ");
  };

  // "Plan para tu proximo live": the suggested time is the category with the
  // largest live sample (most confident recommendation); products prioritize
  // what she already has (Recibido/Grabado) over this week's top fashion picks.
  const suggestedEntry = liveEntries.length > 0 ? liveEntries.reduce((best, e) => (e[1].sample_size > best[1].sample_size ? e : best)) : null;

  const ownedReady: LivePlanProduct[] = misProductos
    .filter(readyToFilm)
    .map((i) => ({ product_id: i.id, name: i.name, earnings_per_sale: i.earnings_per_sale ?? 0, talking_point: t("en_vivo_owned_talking_point", lang) }));
  const topFashionPicks: LivePlanProduct[] = [...picksData.picks]
    .filter((p) => p.group === "fashion")
    .sort((a, b) => b.score - a.score)
    .map((p) => ({ product_id: p.product_id, name: p.clean_title, earnings_per_sale: p.earnings_per_sale, talking_point: lang === "es" ? p.summary_es : p.summary_en }));
  const livePlan = buildLivePlan(ownedReady, topFashionPicks, 8);

  // Dedupe by room_id: categories that share an L1 id (e.g. the 3 Moda-core
  // categories) each carry the SAME underlying lives, so flattening
  // without this would show the same live 3+ times.
  const seenRoomIds = new Set<string>();
  const allHighlights = Object.entries(liveHighlights.categories ?? {})
    .flatMap(([, list]) => list)
    .filter((h) => {
      if (seenRoomIds.has(h.room_id)) return false;
      seenRoomIds.add(h.room_id);
      return true;
    })
    .sort((a, b) => b.units_sold - a.units_sold)
    .slice(0, 10);

  container.innerHTML = `
    <h2 class="view-title">${t("en_vivo_title", lang)}</h2>

    <div class="insight-card">
      <h3>${t("en_vivo_best_time_title", lang)}</h3>
      ${
        liveEntries.length === 0
          ? `<p class="empty-state">${t("best_time_video_unavailable", lang)}</p>`
          : `<div class="best-times-list">${liveEntries.map(([cat, lt]) => liveTimeRowHtml(categoryLabel(cat), lt, lang)).join("")}</div>`
      }
    </div>

    <div class="insight-card">
      <h3>${t("en_vivo_plan_title", lang)}</h3>
      ${
        suggestedEntry
          ? `<p class="goal-progress-text">${t("en_vivo_plan_time", lang, { category: categoryLabel(suggestedEntry[0]), days: suggestedEntry[1].best_weekdays.map((d) => t(WEEKDAY_KEYS[d], lang)).join(" / "), window: formatHourRange(suggestedEntry[1].hour_start, suggestedEntry[1].hour_end) })}</p>`
          : `<p class="empty-state">${t("best_time_video_unavailable", lang)}</p>`
      }
      ${
        livePlan.length === 0
          ? `<p class="empty-state">${t("en_vivo_plan_empty", lang)}</p>`
          : `<div class="live-plan-list">${livePlan.map((p) => planProductRowHtml(p, lang)).join("")}</div>`
      }
    </div>

    <div class="insight-card">
      <h3>${t("en_vivo_top_lives_title", lang)}</h3>
      ${
        allHighlights.length === 0
          ? `<p class="empty-state">${t("best_time_video_unavailable", lang)}</p>`
          : `<div class="live-highlight-list">${allHighlights.map((h) => highlightRowHtml(h, lang)).join("")}</div>`
      }
      <p class="best-times-footnote">${t("mejores_horas_ari_note", lang)}</p>
    </div>
  `;
}
