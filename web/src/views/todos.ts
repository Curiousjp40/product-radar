import { loadCandidates } from "../api";
import { assetUrl } from "../asset";
import { t, type Lang } from "../i18n";
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
  return `
    <a class="todos-row${c.suspicious ? " suspicious" : ""}" href="#/product/${c.product_id}">
      <span class="rank">${c.rank}</span>
      ${photo}
      <div class="info">
        <div class="name">${c.clean_title}</div>
        <div class="meta">
          $${c.price.toFixed(2)} &middot; ${formatCount(c.units_7d)} ${t("units_sold_short", lang)} &middot; ${(c.commission_rate * 100).toFixed(0)}% &middot; ${categoryLabel(c, lang)}
          ${c.saturation_badge ? `<span class="saturation-badge saturation-${c.saturation_badge.level}">${t(`saturation_tag_${c.saturation_badge.level}`, lang)}</span>` : ""}
          ${c.pocas_creadoras_latinas ? `<span class="saturation-badge pocas-latinas-badge">${t("pocas_latinas_tag", lang)}</span>` : ""}
        </div>
      </div>
      ${c.is_pick ? `<span class="star">&#9733;</span>` : ""}
    </a>
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

  let group: CategoryGroup = "fashion";
  let categoryFilter = "";
  let sortMode: SortMode = "score";

  const SORT_CHIPS: { mode: SortMode; key: string }[] = [
    { mode: "score", key: "sort_recommended" },
    { mode: "units", key: "sort_most_sold" },
    { mode: "commission", key: "sort_most_commission" },
    { mode: "earn", key: "sort_most_earnings" },
    { mode: "per_hour", key: "sort_most_per_hour" },
    { mode: "entra_ya", key: "sort_entra_ya" },
    { mode: "pocas_latinas", key: "sort_pocas_latinas" },
  ];

  const draw = () => {
    const inGroup = data.candidates.filter((c) => c.group === group);
    const categories = Array.from(new Set(inGroup.map((c) => c.category))).sort(
      (a, b) =>
        (inGroup.find((c) => c.category === a)?.rank ?? 0) - (inGroup.find((c) => c.category === b)?.rank ?? 0),
    );
    const filtered = categoryFilter ? inGroup.filter((c) => c.category === categoryFilter) : inGroup;
    const sorted = sortCandidates(sortMode, filtered);

    container.innerHTML = `
      ${banner}
      <h2 class="view-title">${t("nav_all", lang)}</h2>
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
      ${
        sorted.length === 0
          ? `<p class="empty-state">${t("no_data", lang)}</p>`
          : `<div class="todos-list">${sorted.map((c) => row(c, lang)).join("")}</div>`
      }
    `;

    container.querySelectorAll<HTMLButtonElement>(".group-tabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        group = btn.dataset.group as CategoryGroup;
        categoryFilter = "";
        draw();
      });
    });
    container.querySelectorAll<HTMLButtonElement>(".category-chip-row:not(.sort-chip-row) button").forEach((btn) => {
      btn.addEventListener("click", () => {
        categoryFilter = btn.dataset.category ?? "";
        draw();
      });
    });
    container.querySelectorAll<HTMLButtonElement>(".sort-chip-row button").forEach((btn) => {
      btn.addEventListener("click", () => {
        sortMode = btn.dataset.sort as SortMode;
        draw();
      });
    });
  };

  draw();
}
