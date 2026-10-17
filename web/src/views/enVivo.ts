import { loadBestTimes, loadCandidates, loadLiveHighlights, loadLiveSchedule, loadPicks } from "../api";
import { assetUrl } from "../asset";
import { cellIntensity, findCell, isBestCell, maxMedianUnits } from "../heatGrid";
import { t, type Lang } from "../i18n";
import { buildLivePlan, type LivePlanProduct } from "../livePlan";
import { getAllMisProductos, type MisProducto } from "../misProductos";
import type { HeatGridCell, LiveBestTime, LiveHighlight, LiveScheduleGroup, ScheduleGroupKey } from "../types";

const WEEKDAY_KEYS = ["weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri", "weekday_sat", "weekday_sun"];
const HOUR_SLOTS = Array.from({ length: 12 }, (_, i) => i * 2);
const SCHEDULE_GROUP_KEYS: ScheduleGroupKey[] = ["moda", "zapatos", "muebles", "hogar", "mascotas"];

type EnVivoTab = "plan" | "lives" | "horarios";
const TABS: { value: EnVivoTab; labelKey: string }[] = [
  { value: "plan", labelKey: "en_vivo_tab_plan" },
  { value: "lives", labelKey: "en_vivo_tab_lives" },
  { value: "horarios", labelKey: "en_vivo_tab_horarios" },
];

function formatHourRange(hourStart: number, hourEnd: number): string {
  const to12 = (h: number) => (h % 12 === 0 ? 12 : h % 12);
  const period = (h: number) => (h < 12 ? "AM" : "PM");
  const startPeriod = period(hourStart);
  const endPeriod = period(hourEnd);
  if (startPeriod === endPeriod) return `${to12(hourStart)}-${to12(hourEnd)} ${startPeriod}`;
  return `${to12(hourStart)} ${startPeriod} - ${to12(hourEnd)} ${endPeriod}`;
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
  const photo = p.image_url ? `<img class="photo" src="${assetUrl(p.image_url)}" alt="" loading="lazy" />` : `<div class="photo"></div>`;
  return `
    <div class="live-plan-product">
      ${photo}
      <div class="live-plan-product-body">
        <div class="name">${p.name}</div>
        <div class="meta">${t("earn_headline", lang, { amount: p.earnings_per_sale.toFixed(2) })} &middot; $${p.price.toFixed(2)}</div>
        ${p.isOwned ? `<span class="saturation-badge owned-badge">${t("ya_lo_tienes_tag", lang)}</span>` : ""}
        ${p.liveUnitsSold !== null ? `<div class="meta">${t("en_vivo_sold_in_lives", lang, { n: p.liveUnitsSold })}</div>` : ""}
        ${p.talking_point ? `<p class="live-plan-talking-point">${p.talking_point}</p>` : ""}
      </div>
    </div>
  `;
}

function readyToFilm(item: MisProducto): boolean {
  return item.status === "recibido" || item.status === "grabado";
}

// Horarios (Part B rebuild, 2026-10-16): a day x 2-hour heat grid per real
// group instead of one best-window line per category (12 near-duplicate
// cards collapsed into 5). Weekdays as columns (fits 390px better than 12
// hour columns would), 2-hour blocks as rows; shaded relative to the
// group's own busiest slot, best slot outlined.
function scheduleGroupCardHtml(groupKey: ScheduleGroupKey, group: LiveScheduleGroup, lang: Lang): string {
  const maxMedian = maxMedianUnits(group.grid);
  const rows = HOUR_SLOTS.map((hourStart) => {
    const cells = Array.from({ length: 7 }, (_, weekday) => {
      const cell: HeatGridCell | null = findCell(group.grid, weekday, hourStart);
      const intensity = cell ? cellIntensity(cell, maxMedian) : 0;
      const best = cell && isBestCell(cell, group.best);
      const title = cell ? `${t(WEEKDAY_KEYS[weekday], lang)} ${formatHourRange(hourStart, hourStart + 2)}: ${cell.median_units} ${t("units_sold_short", lang)} (${cell.sample_size})` : "";
      return `<div class="heat-cell${best ? " best" : ""}" style="--intensity:${intensity}" title="${title}"></div>`;
    }).join("");
    return `<div class="heat-row"><span class="heat-row-label">${hourStart}h</span>${cells}</div>`;
  }).join("");
  return `
    <div class="insight-card schedule-group-card">
      <h3>${t(`schedule_group_${groupKey}`, lang)}</h3>
      ${
        group.sample_size === 0
          ? `<p class="empty-state">${t("best_time_video_unavailable", lang)}</p>`
          : `
            <div class="heat-grid">
              <div class="heat-row heat-row-header"><span class="heat-row-label"></span>${WEEKDAY_KEYS.map((k) => `<span class="heat-col-label">${t(k, lang)}</span>`).join("")}</div>
              ${rows}
            </div>
            ${
              group.best
                ? `<p class="best-times-basis">${t("mejores_horas_live_sample_note", lang, { n: group.best.sample_size, level: t(`schedule_group_${groupKey}`, lang) })}</p>
                   ${group.best.median_duration_minutes !== null ? `<p class="best-times-basis">${t("mejores_horas_live_duration_note", lang, { n: group.best.median_duration_minutes })}</p>` : ""}`
                : ""
            }
          `
      }
    </div>
  `;
}

export async function renderEnVivo(container: HTMLElement, lang: Lang, activeTab: EnVivoTab = "plan"): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const [{ data: bestTimes }, { data: liveHighlights }, { data: liveSchedule }, { data: picksData }, { data: candidatesData }, misProductos] =
    await Promise.all([loadBestTimes(), loadLiveHighlights(), loadLiveSchedule(), loadPicks(), loadCandidates(), getAllMisProductos()]);

  const liveEntries = Object.entries(bestTimes.live ?? {}).filter((e): e is [string, LiveBestTime] => e[1] !== null);
  const categoryLabel = (cat: string): string => {
    const c = candidatesData.candidates.find((c) => c.category === cat);
    if (c) return lang === "es" ? c.category_label_es : c.category_label_en;
    return cat.charAt(0).toUpperCase() + cat.slice(1).replaceAll("_", " ");
  };

  // "Plan para tu proximo live": the suggested time is the category with the
  // largest live sample (most confident recommendation); products prioritize
  // what she already has (Recibido/Grabado) over this week's top fashion picks.
  const suggestedEntry = liveEntries.length > 0 ? liveEntries.reduce((best, e) => (e[1].sample_size > best[1].sample_size ? e : best)) : null;

  const ownedReady: LivePlanProduct[] = misProductos
    .filter(readyToFilm)
    .filter((i) => i.product_id !== null)
    .map((i) => ({
      product_id: i.product_id as string,
      name: i.name,
      image_url: i.photo_url,
      price: i.price ?? 0,
      earnings_per_sale: i.earnings_per_sale ?? 0,
      talking_point: t("en_vivo_owned_talking_point", lang),
      isOwned: true,
      liveUnitsSold: null,
    }));
  const ownedProductIdSet = new Set(ownedReady.map((p) => p.product_id));
  const topFashionPicks: LivePlanProduct[] = [...picksData.picks]
    .filter((p) => p.group === "fashion")
    .sort((a, b) => b.score - a.score)
    .map((p) => ({
      product_id: p.product_id,
      name: p.clean_title,
      image_url: p.image_url,
      price: p.price,
      earnings_per_sale: p.earnings_per_sale,
      talking_point: lang === "es" ? p.summary_es : p.summary_en,
      isOwned: ownedProductIdSet.has(p.product_id),
      liveUnitsSold: null,
    }));
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

  const planHtml = `
    <div class="insight-card">
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
  `;

  const livesHtml = `
    <div class="insight-card">
      ${
        allHighlights.length === 0
          ? `<p class="empty-state">${t("best_time_video_unavailable", lang)}</p>`
          : `<div class="live-highlight-list">${allHighlights.map((h) => highlightRowHtml(h, lang)).join("")}</div>`
      }
      <p class="best-times-footnote">${t("mejores_horas_ari_note", lang)}</p>
    </div>
  `;

  const horariosHtml = SCHEDULE_GROUP_KEYS.map((key) =>
    liveSchedule.groups[key] ? scheduleGroupCardHtml(key, liveSchedule.groups[key], lang) : "",
  ).join("");

  const tabContent = activeTab === "plan" ? planHtml : activeTab === "lives" ? livesHtml : horariosHtml;

  container.innerHTML = `
    <h2 class="view-title">${t("en_vivo_title", lang)}</h2>
    <div class="group-tabs" role="tablist">
      ${TABS.map((tab) => `<button type="button" class="${tab.value === activeTab ? "active" : ""}" data-en-vivo-tab="${tab.value}">${t(tab.labelKey, lang)}</button>`).join("")}
    </div>
    ${tabContent}
  `;

  container.querySelectorAll<HTMLButtonElement>("[data-en-vivo-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void renderEnVivo(container, lang, btn.dataset.enVivoTab as EnVivoTab);
    });
  });
}
