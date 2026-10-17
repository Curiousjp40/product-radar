import { loadCandidates, loadHooks, loadPicks } from "../api";
import { bestVideoTimeHtml } from "../bestTime";
import { earningsProgress, earningsThisMonth } from "../earningsGoalLogic";
import { getEntries, getMonthlyGoal } from "../earningsGoal";
import { getHideOwnedPref, setHideOwnedPref } from "../hideOwnedPref";
import { addMisProducto, getAllMisProductos, ownedProductIds, shopRejectionCount, solicitudFromProduct } from "../misProductos";
import { applyOwnedDisplay } from "../ownedListOrdering";
import { applyOwnedSwap } from "../ownedSwap";
import { candidateToPickStub } from "../pickAdapter";
import { t, type Lang } from "../i18n";
import { categoryLabel as resolveCategoryLabel } from "../categoryLabels";
import { categoryHidePromptHtml, countHiddenInCategory, wireCategoryHidePrompt } from "../hideProduct";
import { clearFeedback, getAllFeedback, getAllStatuses, getHiddenCategories, setFeedback, setStatus } from "../pipeline";
import { showUndoToast } from "../toast";
import type { Candidate, CategoryGroup, ComboPair, Pick } from "../types";
import { assetUrl, IMG_FALLBACK } from "../asset";
import { findCombos } from "../combos";
import { backToTopButtonHtml, detailModalHtml, openDetailModal, wireBackToTop, wireDetailModal } from "../detailModal";
import { productCardInfoHtml } from "./productCard";
import { hasRequestedSample, requestSample } from "../samples";
import { yaLoTengoButtonHtml, yaLoTengoSheetHtml, wireYaLoTengo, type YaLoTengoProduct } from "../yaLoTengo";
import { videoSubTabsHtml } from "../videoSubTabs";

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function summaryFor(pick: Pick, lang: Lang): string {
  return lang === "es" ? pick.summary_es : pick.summary_en;
}

const GROUP_FILTERS: { value: "all" | CategoryGroup; labelKey: string }[] = [
  { value: "all", labelKey: "group_filter_all" },
  { value: "fashion", labelKey: "group_filter_moda" },
  { value: "home", labelKey: "group_filter_hogar" },
];

function groupFilterHtml(active: "all" | CategoryGroup, lang: Lang): string {
  return `
    <div class="group-tabs" role="tablist">
      ${GROUP_FILTERS.map(
        (f) =>
          `<button type="button" class="${f.value === active ? "active" : ""}" data-group-filter="${f.value}">${t(f.labelKey, lang)}</button>`,
      ).join("")}
    </div>
  `;
}

function wireGroupFilter(container: HTMLElement, lang: Lang): void {
  container.querySelectorAll<HTMLButtonElement>("[data-group-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.dataset.groupFilter as "all" | CategoryGroup;
      mainListVisibleCount = PAGE_SIZE;
      void renderThisWeek(container, lang, value);
    });
  });
}

function pickCardInput(pick: Pick) {
  return {
    earnings_per_sale: pick.earnings_per_sale,
    price: pick.price,
    commission_rate: pick.commission_rate,
    units_7d: pick.units_7d,
    daily_units_14: pick.daily_units_14,
    creator_count: pick.creator_count,
    ev_typical: pick.ev_typical,
    score: pick.score,
    saturation_badge: pick.saturation_badge,
  };
}

// Design review 0.3/3.2: one compact ProductCard everywhere on this page --
// tapping anywhere on the card (except its two action buttons) opens the
// shared detail modal, never an inline/side panel.
function compactCardHtml(
  productId: string,
  cleanTitle: string,
  imageUrl: string | null,
  category: string,
  infoHtml: string,
): string {
  return `
    <article class="pick-card" data-open-detail="${productId}">
      <div class="card-photo-link">
        ${imageUrl ? `<img class="card-photo" src="${assetUrl(imageUrl)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${IMG_FALLBACK}'" />` : `<div class="card-photo card-photo-placeholder"></div>`}
      </div>
      <div class="card-body">
        <h3 class="card-title">${cleanTitle}</h3>
        ${infoHtml}
        <div class="card-actions" onclick="event.stopPropagation()">
          <button type="button" class="btn-not-for-me" data-action="not-for-me" data-product-id="${productId}" data-category="${category}">${t("not_for_me_button", lang_for_click_guard)}</button>
          ${yaLoTengoButtonHtml(productId, lang_for_click_guard)}
        </div>
      </div>
    </article>
  `;
}
// compactCardHtml is only ever called from within renderThisWeek, which
// sets this before any call -- avoids threading `lang` through one more
// parameter on an already-long call site list below.
let lang_for_click_guard: Lang = "es";

const PAGE_SIZE = 12;
let mainListVisibleCount = PAGE_SIZE;
const expandedCategories = new Set<string>();

// "Esta semana, todo lo demás": the rest of this week's candidates (not in
// the curated ~9 picks), grouped by category, collapsed by default
// (design review section 2: "Everything else this week" starts collapsed
// by category, e.g. "Fajas (28) ▸").
function allThisWeekHtml(
  candidates: Candidate[],
  excludeIds: Set<string>,
  lang: Lang,
  ownedIds: Set<string>,
  monthlyGoalRemaining: number | null,
  hideOwned: boolean,
): string {
  const rest = candidates.filter((c) => !excludeIds.has(c.product_id) && !c.suspicious);
  if (rest.length === 0) return "";
  const byCategory = new Map<string, Candidate[]>();
  for (const c of rest) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }
  const categories = [...byCategory.keys()].sort((a, b) => (byCategory.get(b)!.length - byCategory.get(a)!.length));
  return `
    <h3 class="view-title" style="margin-top:28px">${t("all_this_week_title", lang)}</h3>
    <label class="todos-hide-owned-toggle">
      <input type="checkbox" class="hide-owned-checkbox" ${hideOwned ? "checked" : ""} />
      ${t("hide_owned_toggle_label", lang)}
    </label>
    ${categories
      .map((cat) => {
        const sorted = byCategory.get(cat)!.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
        const items = applyOwnedDisplay(sorted, ownedIds, (c) => c.product_id, hideOwned);
        if (items.length === 0) return "";
        const label = lang === "es" ? items[0].category_label_es : items[0].category_label_en;
        const expanded = expandedCategories.has(cat);
        return `
          <div class="week-category-group">
            <button type="button" class="week-category-group-toggle" data-category-toggle="${cat}" aria-expanded="${expanded}">
              <span>${t("category_group_count", lang, { category: label, n: items.length })}</span>
              <span class="week-category-group-arrow">${expanded ? "▾" : "▸"}</span>
            </button>
            ${
              expanded
                ? `<div class="card-grid card-grid-wide">
                    ${items
                      .map((c) => {
                        const infoHtml = productCardInfoHtml(
                          {
                            earnings_per_sale: c.earnings_per_sale,
                            price: c.price,
                            commission_rate: c.commission_rate,
                            units_7d: c.units_7d,
                            daily_units_14: c.daily_units,
                            creator_count: c.creator_count,
                            ev_typical: c.ev_typical,
                            score: c.score,
                            saturation_badge: c.saturation_badge,
                          },
                          {
                            lang,
                            compact: true,
                            monthlyGoalRemaining,
                            isOwned: ownedIds.has(c.product_id),
                            risingFast: c.rising_fast,
                            pocasLatinas: c.pocas_creadoras_latinas,
                            seasonEventLabel: lang === "es" ? c.season_event_label_es : c.season_event_label_en,
                          },
                        );
                        return compactCardHtml(c.product_id, c.clean_title, c.image_url, c.category, infoHtml);
                      })
                      .join("")}
                  </div>`
                : ""
            }
          </div>
        `;
      })
      .join("")}
  `;
}

// H2 combos: shown above the grid when at least one complementary category
// pair both have a pick this week.
function combosHtml(
  picks: Pick[],
  comboPairs: ComboPair[],
  categoryFitKeywords: Record<string, string[]>,
  lang: Lang,
): string {
  const combos = findCombos(
    picks.map((p) => ({ product_id: p.product_id, category: p.category, clean_title: p.clean_title, earnings_per_sale: p.earnings_per_sale })),
    comboPairs,
    categoryFitKeywords,
  );
  if (combos.length === 0) return "";
  return `
    <div class="insight-card combos-card">
      <h3>${t("combos_title", lang)}</h3>
      <div class="combos-row-scroll">
        ${combos
          .map(
            (c) => `
          <div class="combo-row">
            <div class="combo-names">${c.a.clean_title} + ${c.b.clean_title}</div>
            <div class="combo-idea">${lang === "es" ? c.idea_es : c.idea_en}</div>
            <div class="combo-earn">${t("combos_combined_earn", lang, { amount: `$${c.combinedEarnings.toFixed(2)}` })}</div>
          </div>`,
          )
          .join("")}
      </div>
    </div>
  `;
}

// Detail modal body -- same content as before, just rendered inside the
// shared fixed-position overlay instead of a side panel that stayed
// pinned to the top of the page while the list scrolled underneath it
// (real bug reported on the live site: the panel kept showing a
// previously-clicked product, out of view, disconnected from the card).
function detailHtml(pick: Pick, lang: Lang, saved: boolean, ownedIds: Set<string>, monthlyGoalRemaining: number | null): string {
  const categoryLabel = lang === "es" ? pick.category_label_es : pick.category_label_en;
  const summary = summaryFor(pick, lang);
  const videos = pick.videos.slice(0, 3);
  const formula = pick.formula_ganadora;
  const topHashtags = formula?.top_hashtags.slice(0, 5) ?? [];
  const topHook = formula?.top_hooks[0];
  const infoHtml = productCardInfoHtml(pickCardInput(pick), {
    lang,
    monthlyGoalRemaining,
    isOwned: ownedIds.has(pick.product_id),
    pocasLatinas: pick.pocas_creadoras_latinas,
    seasonEventLabel: lang === "es" ? pick.season_event_label_es : pick.season_event_label_en,
  });

  return `
    <div class="week-detail-inner">
      <div class="week-detail-photo-wrap">
        ${pick.image_url ? `<img class="week-detail-photo" src="${assetUrl(pick.image_url)}" alt="${pick.clean_title}" onerror="this.onerror=null;this.src='${IMG_FALLBACK}'" />` : `<div class="week-detail-photo week-detail-photo-placeholder"></div>`}
      </div>
      <h3 class="week-detail-title">${pick.clean_title}</h3>
      <div class="week-detail-meta">${categoryLabel}</div>
      ${infoHtml}
      ${pick.saturation_badge ? `<p class="saturation-reason">${lang === "es" ? pick.saturation_badge.reason_es : pick.saturation_badge.reason_en}</p>` : ""}
      ${pick.pocas_creadoras_latinas ? `<p class="saturation-reason">${t("pocas_latinas_reason", lang)}</p>` : ""}
      ${summary ? `<p class="week-detail-summary">${summary}</p>` : ""}
      ${bestVideoTimeHtml(pick.best_video_time, lang)}
      ${
        videos.length > 0
          ? `<div class="week-detail-videos">
              ${videos
                .map(
                  (v) => `
                <a class="video-thumb week-detail-thumb" href="${v.tiktok_url}" target="_blank" rel="noopener">
                  ${v.cover_url ? `<img src="${assetUrl(v.cover_url)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${IMG_FALLBACK}'" />` : `<div class="video-thumb-placeholder"></div>`}
                  ${v.is_ad ? `<span class="video-ad-tag">${t("ad_tag", lang)}</span>` : ""}
                  <span class="video-views">${formatCount(v.play_count)} ${t("views_short", lang)} &middot; ${v.window_units_sold} ${t("sales_short", lang)}</span>
                </a>`,
                )
                .join("")}
            </div>`
          : `<div class="week-detail-videos-empty">
              <p class="empty-state">${t("no_videos_analyzed_yet", lang)}</p>
              <a href="${pick.tiktok_search_url}" target="_blank" rel="noopener" class="btn-accent">${t("tiktok_videos_button", lang)}</a>
            </div>`
      }
      ${
        topHashtags.length > 0
          ? `<div class="formula-section">
              <div class="formula-section-head">
                <span class="formula-label">${t("top_hashtags_label", lang)}</span>
                <button type="button" class="copy-hashtags-btn" data-hashtags="${topHashtags.map((h) => `#${h.hashtag}`).join(" ")}">${t("copy_all_button", lang)}</button>
              </div>
              <div class="hashtag-chips">${topHashtags.map((h) => `<span class="hashtag-chip">#${h.hashtag}</span>`).join("")}</div>
            </div>`
          : ""
      }
      ${
        topHook
          ? `<div class="formula-section">
              <span class="formula-label">${t("hooks_label", lang)}</span>
              <div class="formula-value">&ldquo;${topHook}&rdquo;</div>
            </div>`
          : ""
      }
      <div class="card-actions week-detail-actions">
        <a class="btn-primary" href="${pick.tiktok_shop_url}" target="_blank" rel="noopener">${t("open_in_tiktok_shop", lang)}</a>
        <button
          type="button"
          class="btn-request-sample ${hasRequestedSample(pick.product_id) ? "active" : ""}"
          data-action="request-sample"
          data-product-id="${pick.product_id}"
          data-price="${pick.price}"
          data-name="${pick.clean_title.replace(/"/g, "&quot;")}"
          ${hasRequestedSample(pick.product_id) ? "disabled" : ""}
        >${hasRequestedSample(pick.product_id) ? t("sample_requested_label", lang) : t("request_sample_button", lang)}</button>
        <button type="button" class="btn-save-pill ${saved ? "active" : ""}" data-action="shortlist" aria-label="${t("save_to_list", lang)}">
          <span aria-hidden="true">${saved ? "♥" : "♡"}</span> ${saved ? t("guardado_label", lang) : t("guardar_button", lang)}
        </button>
        <a class="btn-save-pill" href="#/product/${pick.product_id}">${t("ver_todos_detalles_button", lang)}</a>
        <button type="button" class="btn-not-for-me" data-action="not-for-me" data-product-id="${pick.product_id}" data-category="${pick.category}">${t("not_for_me_button", lang)}</button>
        ${yaLoTengoButtonHtml(pick.product_id, lang)}
      </div>
    </div>
  `;
}

export async function renderThisWeek(container: HTMLElement, lang: Lang, filterGroup: "all" | CategoryGroup = "all"): Promise<void> {
  lang_for_click_guard = lang;
  container.innerHTML = `<p class="empty-state">...</p>`;
  const [{ data: rawData, isSample }, { data: hooks }, { data: candidatesData }] = await Promise.all([
    loadPicks(),
    loadHooks(),
    loadCandidates(),
  ]);
  const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";
  if (rawData.picks.length === 0) {
    container.innerHTML = `${banner}${videoSubTabsHtml("week", lang)}<p class="empty-state">${t("no_data", lang)}</p>`;
    return;
  }
  const [statuses, feedback, misProductos, goal, entries, hideOwned] = await Promise.all([
    getAllStatuses(),
    getAllFeedback(),
    getAllMisProductos(),
    getMonthlyGoal(),
    getEntries(),
    getHideOwnedPref(),
  ]);
  const ownedIds = ownedProductIds(misProductos);
  const today0 = new Date();
  const progress0 = earningsProgress(goal, earningsThisMonth(entries, today0));
  const monthlyGoalRemaining = progress0 ? progress0.remaining : null;
  const hiddenCategories = new Set(getHiddenCategories());
  const eligiblePicks = rawData.picks.filter((p) => feedback[p.product_id] !== "not_for_me" && !hiddenCategories.has(p.category));
  // Part 3 "Ya lo tengo" swap (2026-10-16): drop owned picks and backfill
  // from the full candidate pool so the list stays the same size, same
  // approach as Hoy.
  const eligiblePickIds = new Set(eligiblePicks.map((p) => p.product_id));
  const candidatePool = [...candidatesData.candidates]
    .filter((c) => c.score !== null && !c.suspicious && !eligiblePickIds.has(c.product_id))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map(candidateToPickStub);
  const swappedPicks = applyOwnedSwap(eligiblePicks, candidatePool, ownedIds);
  const data = { ...rawData, picks: swappedPicks };
  const categoryByProductId = new Map(rawData.picks.map((p) => [p.product_id, p.category]));
  if (data.picks.length === 0) {
    container.innerHTML = `${banner}${videoSubTabsHtml("week", lang)}<p class="empty-state">${t("no_data", lang)}</p>`;
    return;
  }
  // Moda/Hogar/Todo filter: applies only to the main grid below -- combosHtml
  // and the "Todos" candidate list are unaffected, same as not-for-me/
  // hidden-category filtering.
  const visiblePicks = filterGroup === "all" ? data.picks : data.picks.filter((p) => p.group === filterGroup);
  const picksById = new Map(data.picks.map((p) => [p.product_id, p]));

  function wireDetail(detailEl: HTMLElement, productId: string): void {
    detailEl.querySelector('[data-action="shortlist"]')?.addEventListener("click", (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      statuses[productId] = "shortlisted";
      void setStatus(productId, "shortlisted");
      renderDetail(productId);
      btn.blur();
    });
    detailEl.querySelector<HTMLButtonElement>('[data-action="request-sample"]')?.addEventListener("click", (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const { price, name } = btn.dataset;
      const product = yaLoTengoProducts.get(productId);
      if (product?.shop_name) {
        const count = shopRejectionCount(misProductos, product.shop_name);
        if (count > 0) {
          const msg = t(count === 1 ? "solicitudes_shop_rejected_before_one" : "solicitudes_shop_rejected_before_many", lang, { n: count });
          if (!window.confirm(msg)) return;
        }
      }
      requestSample(productId, name ?? "", Number(price) || 0, new Date());
      if (product) void addMisProducto(solicitudFromProduct(product));
      renderDetail(productId);
    });
    const copyBtn = detailEl.querySelector<HTMLButtonElement>(".copy-hashtags-btn");
    copyBtn?.addEventListener("click", () => {
      const text = copyBtn.dataset.hashtags ?? "";
      const originalLabel = copyBtn.textContent;
      navigator.clipboard
        .writeText(text)
        .then(() => {
          copyBtn.textContent = t("copied_label", lang);
          setTimeout(() => {
            copyBtn.textContent = originalLabel;
          }, 1500);
        })
        .catch(() => {
          // clipboard unavailable -- chips are still readable on their own
        });
    });
  }

  function renderDetail(productId: string): void {
    const pick = picksById.get(productId);
    const detailEl = container.querySelector<HTMLElement>(".detail-modal-body");
    if (!pick || !detailEl) return;
    const saved = statuses[pick.product_id] === "shortlisted";
    detailEl.innerHTML = detailHtml(pick, lang, saved, ownedIds, monthlyGoalRemaining);
    wireDetail(detailEl, pick.product_id);
  }

  function openDetail(productId: string): void {
    const pick = picksById.get(productId);
    if (!pick) return;
    const saved = statuses[pick.product_id] === "shortlisted";
    openDetailModal(container, detailHtml(pick, lang, saved, ownedIds, monthlyGoalRemaining));
    const detailEl = container.querySelector<HTMLElement>(".detail-modal-body");
    if (detailEl) wireDetail(detailEl, productId);
  }

  if (visiblePicks.length === 0) {
    container.innerHTML = `
      ${banner}
      ${videoSubTabsHtml("week", lang)}
      ${groupFilterHtml(filterGroup, lang)}
      <p class="empty-state">${t("no_data", lang)}</p>
    `;
    wireGroupFilter(container, lang);
    return;
  }
  const excludeIds = new Set(data.picks.map((p) => p.product_id));
  const pageItems = visiblePicks.slice(0, mainListVisibleCount);
  const remaining = visiblePicks.length - pageItems.length;
  container.innerHTML = `
    ${banner}
    ${videoSubTabsHtml("week", lang)}
    ${combosHtml(data.picks, hooks.combo_pairs, hooks.category_fit_keywords, lang)}
    ${groupFilterHtml(filterGroup, lang)}
    <div class="card-grid card-grid-wide">
      ${pageItems
        .map((p) => {
          const infoHtml = productCardInfoHtml(pickCardInput(p), {
            lang,
            compact: true,
            monthlyGoalRemaining,
            isOwned: ownedIds.has(p.product_id),
            pocasLatinas: p.pocas_creadoras_latinas,
            seasonEventLabel: lang === "es" ? p.season_event_label_es : p.season_event_label_en,
          });
          return compactCardHtml(p.product_id, p.clean_title, p.image_url, p.category, infoHtml);
        })
        .join("")}
    </div>
    ${remaining > 0 ? `<button type="button" class="btn-save-pill ver-mas-btn" data-ver-mas>${t("ver_mas_button", lang, { n: remaining })}</button>` : ""}
    <div class="category-hide-prompt-slot"></div>
    ${allThisWeekHtml(candidatesData.candidates, excludeIds, lang, ownedIds, monthlyGoalRemaining, hideOwned)}
    ${yaLoTengoSheetHtml(lang)}
    ${detailModalHtml()}
    ${backToTopButtonHtml(lang)}
  `;
  const yaLoTengoProducts = new Map<string, YaLoTengoProduct>(
    [...rawData.picks, ...candidatePool, ...candidatesData.candidates].map((p) => [
      p.product_id,
      {
        product_id: p.product_id,
        name: p.clean_title,
        photo_url: p.image_url || null,
        category: p.category,
        commission_pct: p.commission_rate,
        tiktok_shop_url: p.tiktok_shop_url,
        price: p.price,
        earnings_per_sale: p.earnings_per_sale,
        effort_minutes: p.effort_minutes,
        shop_name: p.shop_name,
      },
    ]),
  );
  wireGroupFilter(container, lang);
  wireDetailModal(container);
  wireBackToTop(container);
  wireYaLoTengo(container, lang, yaLoTengoProducts, () => void renderThisWeek(container, lang, filterGroup));
  container.querySelector<HTMLInputElement>(".hide-owned-checkbox")?.addEventListener("change", (e) => {
    setHideOwnedPref((e.currentTarget as HTMLInputElement).checked);
    void renderThisWeek(container, lang, filterGroup);
  });

  container.querySelector<HTMLButtonElement>("[data-ver-mas]")?.addEventListener("click", () => {
    mainListVisibleCount += PAGE_SIZE;
    void renderThisWeek(container, lang, filterGroup);
  });

  container.querySelectorAll<HTMLButtonElement>("[data-category-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cat = btn.dataset.categoryToggle!;
      if (expandedCategories.has(cat)) expandedCategories.delete(cat);
      else expandedCategories.add(cat);
      void renderThisWeek(container, lang, filterGroup);
    });
  });

  container.querySelectorAll<HTMLElement>("[data-open-detail]").forEach((card) => {
    card.addEventListener("click", () => openDetail(card.dataset.openDetail!));
  });

  container.querySelectorAll<HTMLButtonElement>('[data-action="not-for-me"]').forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const { productId, category } = btn.dataset;
      if (!productId || !category) return;
      await setFeedback(productId, "not_for_me");
      showUndoToast(lang, t("undo_toast_not_for_me", lang), () => {
        void clearFeedback(productId).then(() => void renderThisWeek(container, lang, filterGroup));
      });
      const updatedFeedback = await getAllFeedback();
      if (!getHiddenCategories().includes(category) && countHiddenInCategory(updatedFeedback, categoryByProductId, category) >= 3) {
        const label = lang === "es" ? rawData.picks.find((p) => p.category === category)?.category_label_es : rawData.picks.find((p) => p.category === category)?.category_label_en;
        const slot = container.querySelector(".category-hide-prompt-slot");
        if (slot) {
          slot.innerHTML = categoryHidePromptHtml(category, resolveCategoryLabel(category, lang, label), lang);
          wireCategoryHidePrompt(container, () => void renderThisWeek(container, lang, filterGroup));
        }
      } else {
        void renderThisWeek(container, lang, filterGroup);
      }
    });
  });
}
