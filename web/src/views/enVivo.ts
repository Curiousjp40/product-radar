import { loadBestTimes, loadCandidates, loadLiveHighlights, loadLiveProducts, loadLiveSchedule, loadPicks } from "../api";
import { assetUrl } from "../asset";
import { cellIntensity, findCell, isBestCell, maxMedianUnits } from "../heatGrid";
import { t, type Lang } from "../i18n";
import { buildLivePlan, type LivePlanProduct } from "../livePlan";
import { getAllMisProductos, type MisProducto } from "../misProductos";
import type { HeatGridCell, LiveBestTime, LiveHighlight, LiveProductDetail, LiveScheduleGroup, ScheduleGroupKey } from "../types";

// Tracks which investigated-live cards are expanded in-place -- module
// level so it survives the full re-render renderEnVivo does on every tab/
// toggle click (a simple inline expand/collapse per card, per the
// 2026-10-16 brief, rather than a separate detail route).
const expandedRoomIds = new Set<string>();

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

const PLACEHOLDER_PRODUCT_IMG =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48'><rect width='48' height='48' fill='%23d8d8d8'/></svg>";
const PLACEHOLDER_AVATAR_IMG =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48'><circle cx='24' cy='24' r='24' fill='%23c8c8c8'/></svg>";

function categoryLabelFromKey(cat: string, lang: Lang): string {
  if (!cat) return "";
  return lang === "es" ? cat.replaceAll("_", " ") : cat.replaceAll("_", " ");
}

// "What to copy" takeaway (2026-10-16 brief): the top 1-2 best-selling
// products by units, templated in ES/EN -- a plain-language reason, same
// convention as the rest of the dashboard's score reasons.
function whatToCopyHtml(products: LiveProductDetail["products"], lang: Lang): string {
  if (products.length === 0) return "";
  const top = [...products].sort((a, b) => b.units_sold - a.units_sold).slice(0, 2);
  const line =
    top.length === 1
      ? t("en_vivo_lives_what_to_copy_single", lang, { title: top[0].title, units: top[0].units_sold })
      : t("en_vivo_lives_what_to_copy_pair", lang, { title1: top[0].title, title2: top[1].title });
  return `<p class="live-products-copy"><strong>${t("en_vivo_lives_what_to_copy", lang)}:</strong> ${line}</p>`;
}

function productThumbHtml(p: LiveProductDetail["products"][number]): string {
  const src = p.image_url ? assetUrl(p.image_url) : PLACEHOLDER_PRODUCT_IMG;
  return `
    <div class="live-products-thumb">
      <img src="${src}" alt="${p.title}" loading="lazy" onerror="this.src='${PLACEHOLDER_PRODUCT_IMG}'" />
    </div>
  `;
}

function salesTimelineHtml(detail: LiveProductDetail, lang: Lang): string {
  if (!detail.sales_timeline || detail.sales_timeline.length === 0) return "";
  const maxUnits = Math.max(...detail.sales_timeline.map((pt) => pt.units_sold), 1);
  const bars = detail.sales_timeline
    .map((pt) => {
      const pct = Math.round((pt.units_sold / maxUnits) * 100);
      return `
        <div class="live-products-timeline-bar" title="${t("en_vivo_lives_timeline_minute", lang, { minute: pt.minute })}: ${pt.units_sold}">
          <div class="live-products-timeline-fill" style="height:${pct}%"></div>
          <span class="live-products-timeline-label">${pt.minute}m</span>
        </div>
      `;
    })
    .join("");
  return `
    <div class="live-products-timeline">
      <div class="live-products-timeline-title">${t("en_vivo_lives_timeline", lang)}</div>
      <div class="live-products-timeline-bars">${bars}</div>
    </div>
  `;
}

function enhancedLiveCardHtml(h: LiveHighlight, detail: LiveProductDetail, lang: Lang): string {
  const expanded = expandedRoomIds.has(h.room_id);
  const hostPhoto = detail.host.photo_url ? assetUrl(detail.host.photo_url) : PLACEHOLDER_AVATAR_IMG;
  const hostLink = detail.host.handle ? `https://www.tiktok.com/@${detail.host.handle}` : null;
  const prices = detail.products.map((p) => p.price).filter((p) => p > 0);
  const priceMin = prices.length ? Math.min(...prices) : null;
  const priceMax = prices.length ? Math.max(...prices) : null;
  const sellsLine = detail.host.top_category
    ? `<p class="live-products-sells-line">${t("en_vivo_lives_what_they_sell", lang, { category: categoryLabelFromKey(detail.host.top_category, lang) })}</p>`
    : "";

  return `
    <div class="live-products-card${expanded ? " expanded" : ""}" data-room-id="${h.room_id}">
      <div class="live-products-header" data-toggle-room="${h.room_id}">
        <img class="live-products-host-photo" src="${hostPhoto}" alt="" loading="lazy" onerror="this.src='${PLACEHOLDER_AVATAR_IMG}'" />
        <div class="live-products-header-body">
          <div class="live-products-host-row">
            ${
              hostLink
                ? `<a class="live-products-host-handle" href="${hostLink}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">@${detail.host.handle}</a>`
                : `<span class="live-products-host-handle">${h.title || "@" + h.creator_handle}</span>`
            }
          </div>
          <div class="meta">${t("en_vivo_lives_followers", lang, { n: detail.host.follower_count.toLocaleString(lang === "es" ? "es-419" : "en-US") })}</div>
          <div class="meta">${t("en_vivo_lives_day28_gmv", lang, { amount: detail.host.day28_gmv.toLocaleString(lang === "es" ? "es-419" : "en-US", { maximumFractionDigits: 0 }) })}</div>
          ${sellsLine}
          <div class="meta">${formatTime(h.started_at, lang)} &middot; ${h.duration_minutes} min</div>
          <div class="meta">${t("en_vivo_highlight_stats", lang, { viewers: h.viewer_count, units: h.units_sold })}${detail.conversion_rate !== null ? ` &middot; ${t("en_vivo_lives_conversion", lang, { pct: Math.round(detail.conversion_rate * 10000) / 100 })}` : ""}</div>
        </div>
      </div>
      <div class="live-products-strip">
        ${detail.products.map(productThumbHtml).join("")}
      </div>
      <button type="button" class="live-products-toggle" data-toggle-room="${h.room_id}">
        ${expanded ? t("en_vivo_lives_view_less", lang) : t("en_vivo_lives_view_more", lang)}
      </button>
      ${
        expanded
          ? `
        <div class="live-products-detail">
          <div class="live-products-detail-title">${t("en_vivo_lives_products_in_live", lang)}</div>
          <div class="live-products-detail-list">
            ${detail.products
              .map(
                (p) => `
              <div class="live-products-detail-row">
                ${productThumbHtml(p)}
                <div class="live-products-detail-row-body">
                  <div class="name">${p.title}</div>
                  <div class="meta">$${p.price.toFixed(2)} &middot; ${p.commission_rate}% &middot; ${p.units_sold} ${t("units_sold_short", lang)}</div>
                </div>
              </div>
            `,
              )
              .join("")}
          </div>
          ${priceMin !== null && priceMax !== null ? `<p class="meta">${t("en_vivo_lives_price_range", lang, { min: priceMin.toFixed(2), max: priceMax.toFixed(2) })}</p>` : ""}
          ${salesTimelineHtml(detail, lang)}
          ${whatToCopyHtml(detail.products, lang)}
        </div>
      `
          : ""
      }
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

export async function renderEnVivo(
  container: HTMLElement,
  lang: Lang,
  activeTab: EnVivoTab = "plan",
  activeScheduleGroup: ScheduleGroupKey = SCHEDULE_GROUP_KEYS[0],
): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const [{ data: bestTimes }, { data: liveHighlights }, { data: liveSchedule }, { data: picksData }, { data: candidatesData }, { data: liveProducts }, misProductos] =
    await Promise.all([
      loadBestTimes(),
      loadLiveHighlights(),
      loadLiveSchedule(),
      loadPicks(),
      loadCandidates(),
      loadLiveProducts(),
      getAllMisProductos(),
    ]);

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

  // For lives WITH investigation data (room_id present in live_products.json)
  // render the enhanced card; everything else keeps the plain row -- no
  // regression for the ~rest of the top 10 that haven't been investigated
  // yet (0 real paid calls made so far, see CLAUDE.md).
  const investigatedLives = liveProducts.lives ?? {};
  const livesHtml = `
    <div class="insight-card">
      ${
        allHighlights.length === 0
          ? `<p class="empty-state">${t("best_time_video_unavailable", lang)}</p>`
          : `<div class="live-highlight-list">${allHighlights
              .map((h) => (investigatedLives[h.room_id] ? enhancedLiveCardHtml(h, investigatedLives[h.room_id], lang) : highlightRowHtml(h, lang)))
              .join("")}</div>`
      }
      ${Object.keys(investigatedLives).length === 0 ? `<p class="best-times-footnote">${t("en_vivo_lives_no_investigation", lang)}</p>` : ""}
    </div>
  `;

  // Roxie's feedback (2026-10-16): one chart at a time via a dropdown,
  // instead of all 5 schedule groups stacked and scrolling.
  const horariosHtml = `
    <div class="schedule-group-picker">
      <select class="schedule-group-select">
        ${SCHEDULE_GROUP_KEYS.map((key) => `<option value="${key}" ${key === activeScheduleGroup ? "selected" : ""}>${t(`schedule_group_${key}`, lang)}</option>`).join("")}
      </select>
    </div>
    ${liveSchedule.groups[activeScheduleGroup] ? scheduleGroupCardHtml(activeScheduleGroup, liveSchedule.groups[activeScheduleGroup], lang) : ""}
  `;

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
      void renderEnVivo(container, lang, btn.dataset.enVivoTab as EnVivoTab, activeScheduleGroup);
    });
  });

  container.querySelector<HTMLSelectElement>(".schedule-group-select")?.addEventListener("change", (e) => {
    const value = (e.currentTarget as HTMLSelectElement).value as ScheduleGroupKey;
    void renderEnVivo(container, lang, activeTab, value);
  });

  container.querySelectorAll<HTMLElement>("[data-toggle-room]").forEach((el) => {
    el.addEventListener("click", () => {
      const roomId = el.dataset.toggleRoom as string;
      if (expandedRoomIds.has(roomId)) {
        expandedRoomIds.delete(roomId);
      } else {
        expandedRoomIds.add(roomId);
      }
      void renderEnVivo(container, lang, activeTab, activeScheduleGroup);
    });
  });
}
