import { loadCandidates } from "../api";
import { assetUrl } from "../asset";
import { categoryHidePromptHtml, countHiddenInCategory, wireCategoryHidePrompt } from "../hideProduct";
import { t, type Lang } from "../i18n";
import { getAllFeedback, getHiddenCategories, setFeedback } from "../pipeline";
import type { Candidate, CategoryGroup } from "../types";
import { sortCandidates, type SortMode } from "../todosSort";

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function categoryLabel(c: Candidate, lang: Lang): string {
  return lang === "es" ? c.category_label_es : c.category_label_en;
}

function row(c: Candidate, lang: Lang): string {
  const photo = c.image_url
    ? `<img class="photo" src="${assetUrl(c.image_url)}" alt="" loading="lazy" />`
    : `<div class="photo"></div>`;
  const earnLine = t("earn_headline", lang, { amount: c.earnings_per_sale.toFixed(2) });
  return `
    <article class="todos-row${c.suspicious ? " suspicious" : ""}">
      <a class="todos-row-link" href="#/product/${c.product_id}">
        ${photo}
        <div class="info">
          <div class="name">${c.title}</div>
          <div class="todos-row-earn">${earnLine}</div>
          <div class="meta">
            $${c.price.toFixed(2)} &middot; ${(c.commission_rate * 100).toFixed(0)}% ${t("commission", lang)} &middot; ${formatCount(c.units_7d)} ${t("units_sold_short", lang)} &middot; ${categoryLabel(c, lang)}
          </div>
          <div class="todos-row-badges">
            ${c.saturation_badge ? `<span class="saturation-badge saturation-${c.saturation_badge.level}">${t(`saturation_tag_${c.saturation_badge.level}`, lang)}</span>` : ""}
            ${c.pocas_creadoras_latinas ? `<span class="saturation-badge pocas-latinas-badge">${t("pocas_latinas_tag", lang)}</span>` : ""}
            ${c.is_pick ? `<span class="star" title="${t("nav_this_week", lang)}">&#9733;</span>` : ""}
          </div>
        </div>
      </a>
      <a class="btn-save-pill todos-row-tiktok" href="${c.tiktok_shop_url}" target="_blank" rel="noopener">${t("open_in_tiktok_shop", lang)}</a>
      <button type="button" class="btn-not-for-me" data-action="not-for-me" data-product-id="${c.product_id}" data-category="${c.category}">${t("not_for_me_button", lang)}</button>
    </article>
  `;
}

export async function renderTodos(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const { data, isSample } = await loadCandidates();
  const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";

  if (data.candidates.length === 0) {
    container.innerHTML = `${banner}<h2 class="view-title">${t("nav_all", lang)}</h2><p class="empty-state">${t("no_data", lang)}</p>`;
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
    const sorted = sortCandidates(sortMode, filtered);
    const visible = sorted.slice(0, visibleCount);

    container.innerHTML = `
      ${banner}
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
      ${categoryHidePrompt ? categoryHidePromptHtml(categoryHidePrompt.category, categoryHidePrompt.label, lang) : ""}
      ${
        sorted.length === 0
          ? `<p class="empty-state">${t("no_data", lang)}</p>`
          : `<div class="todos-list">${visible.map((c) => row(c, lang)).join("")}</div>
             ${
               sorted.length > visible.length
                 ? `<button type="button" class="btn-save-pill todos-load-more">${t("load_more_button", lang, { n: sorted.length - visible.length })}</button>`
                 : ""
             }`
      }
    `;

    categoryHidePrompt = null;
    wireCategoryHidePrompt(container, draw);
    container.querySelector(".todos-load-more")?.addEventListener("click", () => {
      visibleCount += PAGE_SIZE;
      draw();
    });
    container.querySelectorAll<HTMLButtonElement>('[data-action="not-for-me"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const { productId, category } = btn.dataset;
        if (!productId || !category) return;
        await setFeedback(productId, "not_for_me");
        feedback = await getAllFeedback();
        const label = lang === "es" ? data.candidates.find((c) => c.category === category)?.category_label_es : data.candidates.find((c) => c.category === category)?.category_label_en;
        if (!getHiddenCategories().includes(category) && countHiddenInCategory(feedback, categoryByProductId, category) >= 3) {
          categoryHidePrompt = { category, label: label ?? category };
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
