import { loadBestTimes, loadCandidates, loadLiveHighlights, loadLiveProducts, loadLiveSchedule, loadPicks } from "../api";
import { assetUrl, IMG_FALLBACK } from "../asset";
import { initialsCircleDataUri } from "../avatarFallback";
import { categoryLabel as resolveCategoryLabel } from "../categoryLabels";
import { backToTopButtonHtml, detailModalHtml, openDetailModal, wireBackToTop, wireDetailModal } from "../detailModal";
import { addEntry } from "../earningsGoal";
import { t, type Lang } from "../i18n";
import { answerCardHtml, dayBarChartHtml, hourBarChartHtml } from "./answerCard";
import { buildLivePlan, type LivePlanProduct } from "../livePlan";
import { aggregateTopLiveProducts, type LiveProductRef } from "../liveProductAggregate";
import { getAllMisProductos, updateMisProducto, type MisProducto } from "../misProductos";
import { hasRequestedSample, requestSample } from "../samples";
import type { LiveBestTime, LiveHighlight, LiveProductDetail, LiveScheduleGroup, ScheduleGroupKey } from "../types";
import { wireYaLoTengo, yaLoTengoButtonHtml, yaLoTengoSheetHtml, type YaLoTengoProduct } from "../yaLoTengo";

// Tracks which investigated-live cards have their "Ver live completo"
// modal open -- module level so it survives the full re-render
// renderEnVivo does on every tab/toggle click.
let openLiveRoomId: string | null = null;
const dismissedPlanIds = new Set<string>();

const WEEKDAY_KEYS = ["weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri", "weekday_sat", "weekday_sun"];
const SCHEDULE_GROUP_KEYS: ScheduleGroupKey[] = ["moda", "zapatos", "muebles", "hogar", "mascotas"];

type EnVivoTab = "plan" | "lives" | "horarios";
const TABS: { value: EnVivoTab; labelKey: string }[] = [
  { value: "plan", labelKey: "en_vivo_tab_plan" },
  { value: "lives", labelKey: "en_vivo_tab_lives" },
  { value: "horarios", labelKey: "en_vivo_tab_horarios" },
];

// Lives que venden filter chips/sort control (density/redesign pass,
// 2026-10-16). The data only carries a coarse `host.top_category`
// ("Fashion" / "Home & Lifestyle" today) plus a free-text category
// breakdown, so the chip filter does a simple keyword match against
// both rather than needing a confirmed FastMoss category taxonomy --
// pure + unit tested in liveFilters.ts.
type LivesFilter = "todo" | "moda" | "zapatos" | "hogar" | "mascotas";
type LivesSort = "sales" | "conversion" | "recent";
let livesFilter: LivesFilter = "todo";
let livesSort: LivesSort = "sales";
const LIVES_FILTER_KEYS: LivesFilter[] = ["todo", "moda", "zapatos", "hogar", "mascotas"];
const LIVES_SORT_KEYS: LivesSort[] = ["sales", "conversion", "recent"];

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
  return d.toLocaleString(lang === "es" ? "es-MX" : "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

const PLACEHOLDER_PRODUCT_IMG = IMG_FALLBACK;

function tiktokShopUrlFor(productId: string): string {
  return `https://www.tiktok.com/shop/pdp/${productId}`;
}

function categoryLabelFromKey(cat: string, lang: Lang): string {
  if (!cat) return "";
  return resolveCategoryLabel(cat, lang);
}

function matchesLivesFilter(detail: LiveProductDetail, filter: LivesFilter): boolean {
  if (filter === "todo") return true;
  const haystack = [detail.host.top_category, ...detail.category_breakdown.map((c) => c.category), ...detail.products.map((p) => p.title)]
    .join(" ")
    .toLowerCase();
  const KEYWORDS: Record<Exclude<LivesFilter, "todo">, string[]> = {
    moda: ["fashion", "shapewear", "dress", "clothing", "apparel"],
    zapatos: ["shoe", "boot", "sandal", "sneaker"],
    hogar: ["home", "lifestyle", "decor", "storage", "furniture", "kitchen"],
    mascotas: ["pet", "dog", "cat"],
  };
  return KEYWORDS[filter].some((kw) => haystack.includes(kw));
}

function sortLives(entries: [LiveHighlight, LiveProductDetail][], sort: LivesSort): [LiveHighlight, LiveProductDetail][] {
  const copy = [...entries];
  if (sort === "sales") return copy.sort((a, b) => b[1].units_sold - a[1].units_sold);
  if (sort === "conversion") return copy.sort((a, b) => (b[1].conversion_rate ?? 0) - (a[1].conversion_rate ?? 0));
  return copy.sort((a, b) => new Date(b[0].started_at).getTime() - new Date(a[0].started_at).getTime());
}

/** Light product detail (Ryan's shared-card follow-up, 2026-10-16): used
 * for products that come only from a live investigation and don't
 * necessarily match anything in the main candidates/picks dataset -- just
 * photo, price, units sold in that live, and a TikTok Shop link, never a
 * broken card pretending to have video/hashtag/best-time data we don't
 * have for it. */
function lightProductDetailHtml(p: { title: string; image_url: string | null; price: number; units_sold: number; product_id: string }, lang: Lang): string {
  const src = p.image_url ? assetUrl(p.image_url) : PLACEHOLDER_PRODUCT_IMG;
  return `
    <div class="light-product-detail">
      <img class="light-product-detail-photo" src="${src}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER_PRODUCT_IMG}'" />
      <h3>${p.title}</h3>
      <p class="meta">$${p.price.toFixed(2)} &middot; ${p.units_sold} ${t("units_sold_short", lang)}</p>
      <a class="btn-primary" href="${tiktokShopUrlFor(p.product_id)}" target="_blank" rel="noopener">${t("open_in_tiktok_shop", lang)}</a>
    </div>
  `;
}

function productThumbHtml(p: LiveProductDetail["products"][number], lang: Lang): string {
  const src = p.image_url ? assetUrl(p.image_url) : PLACEHOLDER_PRODUCT_IMG;
  return `
    <div class="live-products-thumb-card" data-open-light-product data-product='${JSON.stringify(p).replace(/'/g, "&#39;")}'>
      <div class="live-products-thumb">
        <img src="${src}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER_PRODUCT_IMG}'" />
      </div>
      <div class="live-products-thumb-name">${p.title}</div>
      <div class="live-products-thumb-meta">$${p.price.toFixed(2)} &middot; ${p.units_sold} ${t("units_sold_short", lang)}</div>
      <div class="live-products-thumb-actions" onclick="event.stopPropagation()">
        ${yaLoTengoButtonHtml(p.product_id, lang)}
        <button type="button" class="btn-save-pill" data-action="request-sample" data-product-id="${p.product_id}" ${hasRequestedSample(p.product_id) ? "disabled" : ""}>
          ${hasRequestedSample(p.product_id) ? t("sample_requested_label", lang) : t("request_sample_button", lang)}
        </button>
        <a class="btn-save-pill" href="${tiktokShopUrlFor(p.product_id)}" target="_blank" rel="noopener">${t("open_in_tiktok_shop", lang)}</a>
      </div>
    </div>
  `;
}

function liveCardHtml(h: LiveHighlight, detail: LiveProductDetail, lang: Lang): string {
  const hostPhoto = detail.host.photo_url ? assetUrl(detail.host.photo_url) : initialsCircleDataUri(detail.host.handle, 64);
  const avatarFallback = initialsCircleDataUri(detail.host.handle, 64);
  const hostLink = detail.host.handle ? `https://www.tiktok.com/@${detail.host.handle}` : null;
  const sellsLine = detail.host.top_category
    ? `<p class="live-products-sells-line">${t("en_vivo_lives_what_they_sell", lang, { category: categoryLabelFromKey(detail.host.top_category, lang) })}</p>`
    : "";

  return `
    <div class="live-products-card" data-room-id="${h.room_id}">
      <div class="live-products-header">
        <img class="live-products-host-photo" src="${hostPhoto}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${avatarFallback}'" />
        <div class="live-products-header-body">
          <div class="live-products-host-row">
            ${hostLink ? `<a class="live-products-host-handle" href="${hostLink}" target="_blank" rel="noopener noreferrer">@${detail.host.handle}</a>` : `<span class="live-products-host-handle">${h.title || "@" + h.creator_handle}</span>`}
          </div>
          <div class="meta">${t("en_vivo_lives_followers", lang, { n: detail.host.follower_count.toLocaleString(lang === "es" ? "es-419" : "en-US") })}</div>
          <div class="meta">${t("en_vivo_lives_day28_gmv", lang, { amount: detail.host.day28_gmv.toLocaleString(lang === "es" ? "es-419" : "en-US", { maximumFractionDigits: 0 }) })}</div>
          ${sellsLine}
        </div>
      </div>
      <div class="live-products-stats-row">
        <div class="live-products-stat"><b>${h.viewer_count.toLocaleString()}</b><span>${t("en_vivo_lives_stat_viewers", lang)}</span></div>
        <div class="live-products-stat"><b>${h.units_sold}</b><span>${t("en_vivo_lives_stat_sales", lang)}</span></div>
        <div class="live-products-stat"><b>${detail.conversion_rate !== null ? `${Math.round(detail.conversion_rate * 10000) / 100}%` : "--"}</b><span>${t("en_vivo_lives_stat_conversion", lang)}</span></div>
        <div class="live-products-stat"><b>${h.duration_minutes}m</b><span>${t("en_vivo_lives_stat_duration", lang)}</span></div>
      </div>
      <p class="meta live-products-datetime">${formatTime(h.started_at, lang)} ET</p>
      <div class="live-products-strip">
        ${detail.products.map((p) => productThumbHtml(p, lang)).join("")}
      </div>
      <button type="button" class="live-products-toggle" data-open-live-detail="${h.room_id}">
        ${t("en_vivo_lives_view_more", lang)}
      </button>
    </div>
  `;
}

function liveDetailModalHtml(h: LiveHighlight, detail: LiveProductDetail, lang: Lang): string {
  const prices = detail.products.map((p) => p.price).filter((p) => p > 0);
  const priceMin = prices.length ? Math.min(...prices) : null;
  const priceMax = prices.length ? Math.max(...prices) : null;
  const top = [...detail.products].sort((a, b) => b.units_sold - a.units_sold).slice(0, 2);
  const whatToCopy =
    top.length === 1
      ? t("en_vivo_lives_what_to_copy_single", lang, { title: top[0].title, units: top[0].units_sold })
      : top.length > 1
        ? t("en_vivo_lives_what_to_copy_pair", lang, { title1: top[0].title, title2: top[1].title })
        : "";
  return `
    <h3>${h.title || "@" + h.creator_handle}</h3>
    <p class="meta">${formatTime(h.started_at, lang)} ET &middot; ${h.duration_minutes} min</p>
    <div class="live-products-detail-list">
      ${detail.products
        .map(
          (p) => `
        <div class="live-products-detail-row">
          <img class="live-products-detail-row-photo" src="${p.image_url ? assetUrl(p.image_url) : PLACEHOLDER_PRODUCT_IMG}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER_PRODUCT_IMG}'" />
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
    ${whatToCopy ? `<p class="live-products-copy"><strong>${t("en_vivo_lives_what_to_copy", lang)}:</strong> ${whatToCopy}</p>` : ""}
  `;
}

function planProductRowHtml(p: LivePlanProduct, index: number, lang: Lang): string {
  const photo = p.image_url ? `<img class="photo" src="${assetUrl(p.image_url)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER_PRODUCT_IMG}'" />` : `<div class="photo"></div>`;
  return `
    <div class="live-plan-product" data-open-light-product data-product='${JSON.stringify({ product_id: p.product_id, title: p.name, image_url: p.image_url, price: p.price, units_sold: p.liveUnitsSold ?? 0 }).replace(/'/g, "&#39;")}'>
      <span class="live-plan-order-badge">${index + 1}</span>
      ${photo}
      <div class="live-plan-product-body">
        <div class="name">${p.name}</div>
        <div class="meta">${t("earn_headline", lang, { amount: p.earnings_per_sale.toFixed(2) })} &middot; $${p.price.toFixed(2)}</div>
        ${p.isOwned ? `<span class="saturation-badge owned-badge">${t("ya_lo_tienes_tag", lang)}</span>` : ""}
        ${p.liveUnitsSold !== null ? `<div class="meta">${t("en_vivo_sold_in_lives", lang, { n: p.liveUnitsSold })}</div>` : ""}
        ${!p.isOwned && p.talking_point ? `<p class="live-plan-talking-point">${p.talking_point}</p>` : ""}
        <div class="live-plan-actions" onclick="event.stopPropagation()">
          ${
            p.isOwned
              ? `
            <button type="button" class="btn-primary" data-action="toggle-venta" data-id="${p.misProductoId ?? ""}">${t("quick_venta_button", lang)}</button>
            <a class="btn-save-pill" href="${p.tiktokShopUrl}" target="_blank" rel="noopener">${t("open_in_tiktok_shop", lang)}</a>
          `
              : yaLoTengoButtonHtml(p.product_id, lang)
          }
          <button type="button" class="btn-link-remove" data-action="quitar-del-plan" data-product-id="${p.product_id}">${t("en_vivo_quitar_del_plan", lang)}</button>
        </div>
        ${
          p.isOwned
            ? `
          <form class="earnings-goal-form quick-venta-form" data-form="quick-venta-item" data-id="${p.misProductoId ?? ""}" style="display:none" onclick="event.stopPropagation()">
            <input type="number" name="units" min="1" step="1" value="1" placeholder="${t("quick_venta_units_label", lang)}" />
            <input type="number" name="amount" min="0" step="0.01" value="${p.earnings_per_sale ? p.earnings_per_sale.toFixed(2) : ""}" placeholder="${t("quick_venta_amount_label", lang)}" required />
            <input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}" max="${new Date().toISOString().slice(0, 10)}" />
            <button type="submit" class="btn-primary">${t("quick_venta_save_button", lang)}</button>
          </form>
        `
            : ""
        }
      </div>
    </div>
  `;
}

function readyToFilm(item: MisProducto): boolean {
  return item.status === "recibido" || item.status === "grabado";
}

function topLiveProductsSectionHtml(lives: Record<string, LiveProductDetail>, lang: Lang): string {
  const livesProducts: LiveProductRef[][] = Object.values(lives).map((d) =>
    d.products.map((p) => ({ product_id: p.product_id, title: p.title, image_url: p.image_url, price: p.price, units_sold: p.units_sold })),
  );
  const top = aggregateTopLiveProducts(livesProducts, 12);
  if (top.length === 0) return "";
  return `
    <div class="insight-card">
      <h3>${t("en_vivo_lives_top_products_title", lang)}</h3>
      <div class="live-top-products-grid">
        ${top
          .map(
            (p) => `
          <div class="live-top-product-card" data-open-light-product data-product='${JSON.stringify({ product_id: p.product_id, title: p.title, image_url: p.image_url, price: p.best_price, units_sold: p.total_units_sold }).replace(/'/g, "&#39;")}'>
            <img class="photo" src="${p.image_url ? assetUrl(p.image_url) : PLACEHOLDER_PRODUCT_IMG}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER_PRODUCT_IMG}'" />
            <div class="live-top-product-name">${p.title}</div>
            <div class="meta">${t("en_vivo_lives_top_products_stats", lang, { units: p.total_units_sold, lives: p.live_count, price: p.best_price.toFixed(2) })}</div>
          </div>
        `,
          )
          .join("")}
      </div>
    </div>
  `;
}

// Design review 3.7: replaced the day x hour heat grid (illegible labels,
// best highlight could disagree with the darkest cell) with an AnswerCard
// + two bar charts, same pattern as Videos -> Mejores horas.
function scheduleGroupCardHtml(groupKey: ScheduleGroupKey, group: LiveScheduleGroup, lang: Lang): string {
  return `
    <div class="insight-card schedule-group-card">
      <h3>${t(`schedule_group_${groupKey}`, lang)}</h3>
      ${
        group.sample_size === 0
          ? `<p class="empty-state">${t("best_time_video_unavailable", lang)}</p>`
          : `
            ${answerCardHtml(group.best, t(`schedule_group_${groupKey}`, lang), lang, "live")}
            ${dayBarChartHtml(group.grid, lang)}
            ${hourBarChartHtml(group.grid, lang)}
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
    return resolveCategoryLabel(cat, lang, c ? (lang === "es" ? c.category_label_es : c.category_label_en) : null);
  };

  const suggestedEntry = liveEntries.length > 0 ? liveEntries.reduce((best, e) => (e[1].sample_size > best[1].sample_size ? e : best)) : null;

  const ownedReady: LivePlanProduct[] = misProductos
    .filter(readyToFilm)
    .filter((i) => i.product_id !== null && !dismissedPlanIds.has(i.product_id))
    .map((i) => ({
      product_id: i.product_id as string,
      name: i.name,
      image_url: i.photo_url,
      price: i.price ?? 0,
      earnings_per_sale: i.earnings_per_sale ?? 0,
      talking_point: "",
      isOwned: true,
      liveUnitsSold: null,
      misProductoId: i.id,
      tiktokShopUrl: i.tiktok_shop_url ?? tiktokShopUrlFor(i.product_id as string),
    }));
  const ownedProductIdSet = new Set(ownedReady.map((p) => p.product_id));
  const topFashionPicks: LivePlanProduct[] = [...picksData.picks]
    .filter((p) => p.group === "fashion")
    .filter((p) => !dismissedPlanIds.has(p.product_id))
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
      misProductoId: null,
      tiktokShopUrl: p.tiktok_shop_url ?? tiktokShopUrlFor(p.product_id),
    }));
  const livePlan = buildLivePlan(ownedReady, topFashionPicks, 8);

  const seenRoomIds = new Set<string>();
  const allHighlights = Object.entries(liveHighlights.categories ?? {})
    .flatMap(([, list]) => list)
    .filter((h) => {
      if (seenRoomIds.has(h.room_id)) return false;
      seenRoomIds.add(h.room_id);
      return true;
    });

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
          : `<div class="live-plan-list">${livePlan.map((p, i) => planProductRowHtml(p, i, lang)).join("")}</div>`
      }
    </div>
  `;

  // Investigated lives only (density/redesign pass, 2026-10-16): the
  // "Lives que venden" tab now shows ONLY lives with real host+products
  // data, per Ryan's brief -- no more plain uninvestigated-highlight rows.
  const investigatedLives = liveProducts.lives ?? {};
  const investigatedEntries: [LiveHighlight, LiveProductDetail][] = allHighlights
    .filter((h) => investigatedLives[h.room_id])
    .map((h) => [h, investigatedLives[h.room_id]] as [LiveHighlight, LiveProductDetail]);
  const filteredSorted = sortLives(investigatedEntries.filter(([, d]) => matchesLivesFilter(d, livesFilter)), livesSort);
  const openEntry = openLiveRoomId ? filteredSorted.find(([h]) => h.room_id === openLiveRoomId) : null;

  const livesHtml = `
    <div class="insight-card">
      <div class="lives-filter-chips">
        ${LIVES_FILTER_KEYS.map((k) => `<button type="button" class="filter-chip ${k === livesFilter ? "active" : ""}" data-lives-filter="${k}">${t(`en_vivo_lives_filter_${k}`, lang)}</button>`).join("")}
      </div>
      <select class="lives-sort-select">
        ${LIVES_SORT_KEYS.map((k) => `<option value="${k}" ${k === livesSort ? "selected" : ""}>${t(`en_vivo_lives_sort_${k}`, lang)}</option>`).join("")}
      </select>
      ${
        filteredSorted.length === 0
          ? `<p class="empty-state">${t("en_vivo_lives_no_investigation", lang)}</p>`
          : `<div class="live-highlight-list">${filteredSorted.map(([h, d]) => liveCardHtml(h, d, lang)).join("")}</div>`
      }
    </div>
    ${topLiveProductsSectionHtml(investigatedLives, lang)}
  `;

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
    <div class="group-tabs sticky-tab-bar" role="tablist">
      ${TABS.map((tab) => `<button type="button" class="${tab.value === activeTab ? "active" : ""}" data-en-vivo-tab="${tab.value}">${t(tab.labelKey, lang)}</button>`).join("")}
    </div>
    ${tabContent}
    ${yaLoTengoSheetHtml(lang)}
    ${detailModalHtml()}
    ${backToTopButtonHtml(lang)}
  `;

  wireDetailModal(container);
  wireBackToTop(container);
  if (openEntry) openDetailModal(container, liveDetailModalHtml(openEntry[0], openEntry[1], lang));

  container.querySelectorAll<HTMLButtonElement>("[data-en-vivo-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openLiveRoomId = null;
      void renderEnVivo(container, lang, btn.dataset.enVivoTab as EnVivoTab, activeScheduleGroup);
    });
  });

  container.querySelector<HTMLSelectElement>(".schedule-group-select")?.addEventListener("change", (e) => {
    const value = (e.currentTarget as HTMLSelectElement).value as ScheduleGroupKey;
    void renderEnVivo(container, lang, activeTab, value);
  });

  container.querySelectorAll<HTMLButtonElement>("[data-lives-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      livesFilter = btn.dataset.livesFilter as LivesFilter;
      void renderEnVivo(container, lang, activeTab, activeScheduleGroup);
    });
  });

  container.querySelector<HTMLSelectElement>(".lives-sort-select")?.addEventListener("change", (e) => {
    livesSort = (e.currentTarget as HTMLSelectElement).value as LivesSort;
    void renderEnVivo(container, lang, activeTab, activeScheduleGroup);
  });

  container.querySelectorAll<HTMLElement>("[data-open-live-detail]").forEach((el) => {
    el.addEventListener("click", () => {
      openLiveRoomId = el.dataset.openLiveDetail as string;
      void renderEnVivo(container, lang, activeTab, activeScheduleGroup);
    });
  });

  container.querySelectorAll<HTMLElement>("[data-open-light-product]").forEach((el) => {
    el.addEventListener("click", () => {
      try {
        const p = JSON.parse(el.dataset.product ?? "{}");
        openDetailModal(container, lightProductDetailHtml(p, lang));
      } catch {
        /* malformed product data -- no-op rather than a broken modal */
      }
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-action="request-sample"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.productId;
      if (!id) return;
      const flat = Object.values(investigatedLives)
        .flatMap((d) => d.products)
        .find((p) => p.product_id === id);
      requestSample(id, flat?.title ?? id, flat?.price ?? 0, new Date());
      void renderEnVivo(container, lang, activeTab, activeScheduleGroup);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-action="quitar-del-plan"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.productId;
      if (!id) return;
      dismissedPlanIds.add(id);
      void renderEnVivo(container, lang, activeTab, activeScheduleGroup);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-action="toggle-venta"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const form = container.querySelector<HTMLElement>(`[data-form="quick-venta-item"][data-id="${btn.dataset.id}"]`);
      if (form) form.style.display = form.style.display === "none" ? "flex" : "none";
    });
  });

  container.querySelectorAll<HTMLFormElement>('[data-form="quick-venta-item"]').forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = form.dataset.id;
      if (!id) return;
      const unitsInput = form.querySelector<HTMLInputElement>('[name="units"]');
      const amountInput = form.querySelector<HTMLInputElement>('[name="amount"]');
      const dateInput = form.querySelector<HTMLInputElement>('[name="date"]');
      const units = Number(unitsInput?.value) || 1;
      const amount = Number(amountInput?.value);
      const date = dateInput?.value;
      if (!(amount > 0) || !date) return;
      await addEntry(amount, date, { productId: id, units });
      const current = misProductos.find((i) => i.id === id);
      await updateMisProducto(id, {
        units: (current?.units ?? 0) + units,
        earnings: (current?.earnings ?? 0) + amount,
        status: current?.status === "vendiendo" ? current.status : "vendiendo",
      });
      void renderEnVivo(container, lang, activeTab, activeScheduleGroup);
    });
  });

  const yaLoTengoProducts = new Map<string, YaLoTengoProduct>(
    [...ownedReady, ...topFashionPicks].map((p) => [
      p.product_id,
      {
        product_id: p.product_id,
        name: p.name,
        photo_url: p.image_url,
        category: null,
        commission_pct: null,
        tiktok_shop_url: p.tiktokShopUrl,
        price: p.price,
        earnings_per_sale: p.earnings_per_sale,
        effort_minutes: null,
        shop_name: null,
      },
    ]),
  );
  // Also cover products that only exist on live-investigation thumbnails
  // (not in picks/owned), using the light fallback shape.
  Object.values(investigatedLives).forEach((d) =>
    d.products.forEach((p) => {
      if (!yaLoTengoProducts.has(p.product_id)) {
        yaLoTengoProducts.set(p.product_id, {
          product_id: p.product_id,
          name: p.title,
          photo_url: p.image_url,
          category: null,
          commission_pct: p.commission_rate ?? null,
          tiktok_shop_url: tiktokShopUrlFor(p.product_id),
          price: p.price,
          earnings_per_sale: null,
          effort_minutes: null,
          shop_name: null,
        });
      }
    }),
  );
  wireYaLoTengo(container, lang, yaLoTengoProducts, () => void renderEnVivo(container, lang, activeTab, activeScheduleGroup));
}
