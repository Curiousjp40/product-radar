import { loadCandidates } from "../api";
import { assetUrl, IMG_FALLBACK } from "../asset";
import { categoryLabel as resolveCategoryLabel } from "../categoryLabels";
import { categoryHidePromptHtml, countHiddenInCategory, wireCategoryHidePrompt } from "../hideProduct";
import { getHideOwnedPref, setHideOwnedPref } from "../hideOwnedPref";
import { t, type Lang } from "../i18n";
import { earningsProgress, earningsThisMonth } from "../earningsGoalLogic";
import { getEntries, getMonthlyGoal } from "../earningsGoal";
import { addMisProductos, emptyMisProducto, getAllMisProductos, ownedProductIds } from "../misProductos";
import { applyOwnedDisplay } from "../ownedListOrdering";
import { clearFeedback, getAllFeedback, getHiddenCategories, setFeedback } from "../pipeline";
import { showUndoToast } from "../toast";
import type { Candidate, CategoryGroup } from "../types";
import { sortCandidates, type SortMode } from "../todosSort";
import { productCardInfoHtml } from "./productCard";
import { yaLoTengoButtonHtml, yaLoTengoSheetHtml, wireYaLoTengo, type YaLoTengoProduct } from "../yaLoTengo";
import { videoSubTabsHtml } from "../videoSubTabs";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Part A.4 (2026-10-16): the bulk "Ya los tengo" confirm sheet -- one
// shared sample/bought choice and date for every selected product, reusing
// the single-item sheet's visual style but its own class/wiring (the
// single-item one is built around exactly one active product at a time).
function bulkSheetHtml(lang: Lang): string {
  return `
    <div class="ya-lo-tengo-sheet bulk-ya-lo-tengo-sheet" hidden>
      <div class="ya-lo-tengo-sheet-inner">
        <h4>${t("ya_lo_tengo_sheet_title", lang)}</h4>
        <div class="ya-lo-tengo-source-choice">
          <button type="button" class="bulk-source-btn active" data-source="muestra">${t("ya_lo_tengo_source_muestra", lang)}</button>
          <button type="button" class="bulk-source-btn" data-source="comprado">${t("ya_lo_tengo_source_comprado", lang)}</button>
        </div>
        <label class="ya-lo-tengo-field">
          <span>${t("ya_lo_tengo_date_label", lang)}</span>
          <input type="date" class="bulk-date" value="${todayIso()}" max="${todayIso()}" />
        </label>
        <div class="ya-lo-tengo-sheet-actions">
          <button type="button" class="btn-save-pill bulk-sheet-cancel">${t("cancel_button", lang)}</button>
          <button type="button" class="btn-primary bulk-sheet-confirm">${t("ya_lo_tengo_confirm_button", lang)}</button>
        </div>
      </div>
    </div>
  `;
}

function row(
  c: Candidate,
  lang: Lang,
  ownedProductIds: Set<string>,
  monthlyGoalRemaining: number | null,
  bulkMode: boolean,
  selected: boolean,
): string {
  const photo = c.image_url
    ? `<img class="photo" src="${assetUrl(c.image_url)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${IMG_FALLBACK}'" />`
    : `<div class="photo"></div>`;
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
      monthlyGoalRemaining,
      isOwned: ownedProductIds.has(c.product_id),
      risingFast: c.rising_fast,
      pocasLatinas: c.pocas_creadoras_latinas,
      seasonEventLabel: lang === "es" ? c.season_event_label_es : c.season_event_label_en,
    },
  );
  return `
    <article class="todos-row${c.suspicious ? " suspicious" : ""}" style="position:relative">
      ${bulkMode ? `<input type="checkbox" class="bulk-select-checkbox" data-bulk-select="${c.product_id}" ${selected ? "checked" : ""} />` : ""}
      <a class="todos-row-link" href="${bulkMode ? "#" : `#/product/${c.product_id}`}" data-bulk-toggle="${c.product_id}">
        ${photo}
        <div class="info">
          <div class="name">${c.title}</div>
          ${infoHtml}
          ${c.is_pick ? `<span class="star" title="${t("nav_this_week", lang)}">&#9733;</span>` : ""}
        </div>
      </a>
      ${
        bulkMode
          ? ""
          : `<a class="btn-save-pill todos-row-tiktok" href="${c.tiktok_shop_url}" target="_blank" rel="noopener">${t("open_in_tiktok_shop", lang)}</a>
      <button type="button" class="btn-not-for-me" data-action="not-for-me" data-product-id="${c.product_id}" data-category="${c.category}">${t("not_for_me_button", lang)}</button>
      ${yaLoTengoButtonHtml(c.product_id, lang)}`
      }
    </article>
  `;
}

export async function renderTodos(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const [{ data, isSample }, misProductos, goal, entries] = await Promise.all([
    loadCandidates(),
    getAllMisProductos(),
    getMonthlyGoal(),
    getEntries(),
  ]);
  const ownedIds = ownedProductIds(misProductos);
  const today = new Date();
  const progress = earningsProgress(goal, earningsThisMonth(entries, today));
  const monthlyGoalRemaining = progress ? progress.remaining : null;
  const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";

  if (data.candidates.length === 0) {
    container.innerHTML = `${banner}${videoSubTabsHtml("todos", lang)}<h2 class="view-title">${t("nav_all", lang)}</h2><p class="empty-state">${t("no_data", lang)}</p>`;
    return;
  }

  const PAGE_SIZE = 40;
  let group: CategoryGroup = "fashion";
  let categoryFilter = "";
  let sortMode: SortMode = "score";
  let searchQuery = "";
  let visibleCount = PAGE_SIZE;

  const SORT_CHIPS: { mode: SortMode; key: string }[] = [
    { mode: "score", key: "sort_recommended" },
    { mode: "units", key: "sort_most_sold" },
    { mode: "commission", key: "sort_most_commission" },
    { mode: "earn", key: "sort_most_earnings" },
    { mode: "per_hour", key: "sort_most_per_hour" },
    { mode: "entra_ya", key: "sort_entra_ya" },
    { mode: "pocas_latinas", key: "sort_pocas_latinas" },
  ];

  const categoryByProductId = new Map(data.candidates.map((c) => [c.product_id, c.category]));
  let feedback: Record<string, string> = await getAllFeedback();
  let categoryHidePrompt: { category: string; label: string } | null = null;
  let hideOwned = await getHideOwnedPref();
  let bulkMode = false;
  let selectedIds = new Set<string>();
  const candidatesById = new Map(data.candidates.map((c) => [c.product_id, c]));

  const draw = () => {
    const hiddenCategories = new Set(getHiddenCategories());
    const inGroup = data.candidates.filter(
      (c) => c.group === group && !c.suspicious && feedback[c.product_id] !== "not_for_me" && !hiddenCategories.has(c.category),
    );
    const categories = Array.from(new Set(inGroup.map((c) => c.category))).sort(
      (a, b) =>
        (inGroup.find((c) => c.category === a)?.rank ?? 0) - (inGroup.find((c) => c.category === b)?.rank ?? 0),
    );
    let filtered = categoryFilter ? inGroup.filter((c) => c.category === categoryFilter) : inGroup;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((c) => c.title.toLowerCase().includes(q) || c.shop_name.toLowerCase().includes(q));
    }
    const sortedByMode = sortCandidates(sortMode, filtered);
    const sorted = applyOwnedDisplay(sortedByMode, ownedIds, (c) => c.product_id, hideOwned);
    const visible = sorted.slice(0, visibleCount);

    container.innerHTML = `
      ${banner}
      ${videoSubTabsHtml("todos", lang)}
      <h2 class="view-title">${t("nav_all", lang)}</h2>
      <div class="todos-search">
        <input type="search" class="todos-search-input" placeholder="${t("search_products_placeholder", lang)}" value="${searchQuery.replace(/"/g, "&quot;")}" />
      </div>
      <div class="group-tabs">
        <button data-group="fashion" class="${group === "fashion" ? "active" : ""}">${t("group_fashion", lang)}</button>
        <button data-group="home" class="${group === "home" ? "active" : ""}">${t("group_home", lang)}</button>
      </div>
      <div class="category-chip-row">
        <button data-category="" class="${categoryFilter === "" ? "active" : ""}">${t("all_categories", lang)}</button>
        ${categories
          .map((cat) => {
            const label = lang === "es" ? inGroup.find((c) => c.category === cat)?.category_label_es : inGroup.find((c) => c.category === cat)?.category_label_en;
            return `<button data-category="${cat}" class="${categoryFilter === cat ? "active" : ""}">${label ?? cat}</button>`;
          })
          .join("")}
      </div>
      <div class="category-chip-row sort-chip-row">
        ${SORT_CHIPS.map((chip) => `<button data-sort="${chip.mode}" class="${sortMode === chip.mode ? "active" : ""}">${t(chip.key, lang)}</button>`).join("")}
      </div>
      <div class="todos-toolbar">
        <label class="todos-hide-owned-toggle">
          <input type="checkbox" class="hide-owned-checkbox" ${hideOwned ? "checked" : ""} />
          ${t("hide_owned_toggle_label", lang)}
        </label>
        <button type="button" class="btn-save-pill todos-bulk-toggle">${t(bulkMode ? "bulk_cancel_button" : "bulk_mark_button", lang)}</button>
      </div>
      ${categoryHidePrompt ? categoryHidePromptHtml(categoryHidePrompt.category, categoryHidePrompt.label, lang) : ""}
      ${
        sorted.length === 0
          ? `<p class="empty-state">${t("no_data", lang)}</p>`
          : `<div class="todos-list">${visible.map((c) => row(c, lang, ownedIds, monthlyGoalRemaining, bulkMode, selectedIds.has(c.product_id))).join("")}</div>
             ${
               sorted.length > visible.length
                 ? `<button type="button" class="btn-save-pill todos-load-more">${t("load_more_button", lang, { n: sorted.length - visible.length })}</button>`
                 : ""
             }`
      }
      ${
        bulkMode && selectedIds.size > 0
          ? `<div class="todos-bulk-bar">
               <span>${t("bulk_selected_count", lang, { n: selectedIds.size })}</span>
               <button type="button" class="btn-primary todos-bulk-confirm">${t("bulk_confirm_button", lang, { n: selectedIds.size })}</button>
             </div>`
          : ""
      }
      ${bulkMode ? bulkSheetHtml(lang) : ""}
      ${yaLoTengoSheetHtml(lang)}
    `;

    categoryHidePrompt = null;
    wireCategoryHidePrompt(container, draw);

    const yaLoTengoProducts = new Map<string, YaLoTengoProduct>(
      data.candidates.map((c) => [
        c.product_id,
        {
          product_id: c.product_id,
          name: c.clean_title,
          photo_url: c.image_url || null,
          category: c.category,
          commission_pct: c.commission_rate,
          tiktok_shop_url: c.tiktok_shop_url,
          price: c.price,
          earnings_per_sale: c.earnings_per_sale,
          effort_minutes: c.effort_minutes,
          shop_name: c.shop_name,
        },
      ]),
    );
    wireYaLoTengo(container, lang, yaLoTengoProducts, () => void renderTodos(container, lang));
    container.querySelector(".todos-load-more")?.addEventListener("click", () => {
      visibleCount += PAGE_SIZE;
      draw();
    });
    container.querySelector<HTMLInputElement>(".hide-owned-checkbox")?.addEventListener("change", (e) => {
      hideOwned = (e.currentTarget as HTMLInputElement).checked;
      setHideOwnedPref(hideOwned);
      draw();
    });

    container.querySelector(".todos-bulk-toggle")?.addEventListener("click", () => {
      bulkMode = !bulkMode;
      selectedIds = new Set();
      draw();
    });
    container.querySelectorAll<HTMLElement>("[data-bulk-toggle]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (!bulkMode) return;
        e.preventDefault();
        const id = el.dataset.bulkToggle!;
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        draw();
      });
    });
    container.querySelectorAll<HTMLInputElement>("[data-bulk-select]").forEach((checkbox) => {
      checkbox.addEventListener("click", (e) => e.stopPropagation());
      checkbox.addEventListener("change", () => {
        const id = checkbox.dataset.bulkSelect!;
        if (checkbox.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        draw();
      });
    });

    const bulkSheet = container.querySelector<HTMLElement>(".bulk-ya-lo-tengo-sheet");
    container.querySelector(".todos-bulk-confirm")?.addEventListener("click", () => {
      if (bulkSheet) bulkSheet.hidden = false;
    });
    if (bulkSheet) {
      const sourceBtns = bulkSheet.querySelectorAll<HTMLButtonElement>(".bulk-source-btn");
      let bulkSource: "muestra" | "comprado" = "muestra";
      sourceBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          bulkSource = (btn.dataset.source as "muestra" | "comprado") ?? "muestra";
          sourceBtns.forEach((b) => b.classList.toggle("active", b === btn));
        });
      });
      bulkSheet.querySelector(".bulk-sheet-cancel")?.addEventListener("click", () => {
        bulkSheet.hidden = true;
      });
      bulkSheet.querySelector(".bulk-sheet-confirm")?.addEventListener("click", () => {
        const dateInput = bulkSheet.querySelector<HTMLInputElement>(".bulk-date");
        const dateReceived = dateInput?.value || todayIso();
        const sourceLabel = t(bulkSource === "muestra" ? "ya_lo_tengo_source_muestra" : "ya_lo_tengo_source_comprado", lang);
        const ids = [...selectedIds];
        const records = ids
          .map((id) => candidatesById.get(id))
          .filter((c): c is Candidate => c !== undefined)
          .map((c) =>
            emptyMisProducto({
              product_id: c.product_id,
              name: c.clean_title,
              photo_url: c.image_url || null,
              category: c.category,
              commission_pct: c.commission_rate,
              tiktok_shop_url: c.tiktok_shop_url,
              shop_name: c.shop_name,
              status: "recibido",
              date_received: dateReceived,
              notes: sourceLabel,
              price: c.price,
              earnings_per_sale: c.earnings_per_sale,
              effort_minutes: c.effort_minutes,
            }),
          );
        void addMisProductos(records).then(() => {
          bulkSheet.hidden = true;
          bulkMode = false;
          selectedIds = new Set();
          void renderTodos(container, lang);
        });
      });
    }
    container.querySelectorAll<HTMLButtonElement>('[data-action="not-for-me"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const { productId, category } = btn.dataset;
        if (!productId || !category) return;
        await setFeedback(productId, "not_for_me");
        showUndoToast(lang, t("undo_toast_not_for_me", lang), () => {
          void clearFeedback(productId).then(async () => {
            feedback = await getAllFeedback();
            draw();
          });
        });
        feedback = await getAllFeedback();
        const label = lang === "es" ? data.candidates.find((c) => c.category === category)?.category_label_es : data.candidates.find((c) => c.category === category)?.category_label_en;
        if (!getHiddenCategories().includes(category) && countHiddenInCategory(feedback, categoryByProductId, category) >= 3) {
          categoryHidePrompt = { category, label: resolveCategoryLabel(category, lang, label) };
        }
        draw();
      });
    });

    container.querySelector<HTMLInputElement>(".todos-search-input")?.addEventListener("input", (e) => {
      searchQuery = (e.currentTarget as HTMLInputElement).value;
      visibleCount = PAGE_SIZE;
      draw();
      const el = container.querySelector<HTMLInputElement>(".todos-search-input");
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = el.value.length;
      }
    });
    container.querySelectorAll<HTMLButtonElement>(".group-tabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        group = btn.dataset.group as CategoryGroup;
        categoryFilter = "";
        visibleCount = PAGE_SIZE;
        draw();
      });
    });
    container.querySelectorAll<HTMLButtonElement>(".category-chip-row:not(.sort-chip-row) button").forEach((btn) => {
      btn.addEventListener("click", () => {
        categoryFilter = btn.dataset.category ?? "";
        visibleCount = PAGE_SIZE;
        draw();
      });
    });
    container.querySelectorAll<HTMLButtonElement>(".sort-chip-row button").forEach((btn) => {
      btn.addEventListener("click", () => {
        sortMode = btn.dataset.sort as SortMode;
        visibleCount = PAGE_SIZE;
        draw();
      });
    });
  };

  draw();
}
