import { loadCandidates, loadMeta } from "../api";
import { categoryLabel as resolveCategoryLabel } from "../categoryLabels";
import { getFavorites, saveFavorites } from "../favorites";
import { hasAnyFavorites, type Favorites } from "../favoritesLogic";
import { locale, t, type Lang } from "../i18n";

function favoritesSectionHtml(fav: Favorites, categories: { key: string; label: string }[], brands: { name: string; count: number }[], lang: Lang): string {
  return `
    <div class="insight-card">
      <h3>${t("favorites_title", lang)}</h3>
      <p class="text-dim" style="font-size:0.8rem">${t("favorites_intro", lang)}</p>
      <div class="favorites-chip-row">
        ${categories
          .map((c) => `<button type="button" class="filter-chip ${fav.categories.includes(c.key) ? "active" : ""}" data-fav-category="${c.key}">${c.label}</button>`)
          .join("")}
      </div>
      ${
        brands.length > 0
          ? `<p class="text-dim" style="font-size:0.78rem;margin-top:10px">${t("favorites_brands_label", lang)}</p>
             <div class="favorites-chip-row">
               ${brands
                 .map((b) => `<button type="button" class="filter-chip ${fav.brands.some((x) => x.toLowerCase() === b.name.toLowerCase()) ? "active" : ""}" data-fav-brand="${b.name.replace(/"/g, "&quot;")}">${b.name} (${b.count})</button>`)
                 .join("")}
             </div>`
          : ""
      }
      <div class="favorites-price-row">
        <label>
          <span class="text-dim" style="font-size:0.78rem">${t("favorites_price_min", lang)}</span>
          <input type="number" class="favorites-price-min" min="0" value="${fav.price_min ?? ""}" />
        </label>
        <label>
          <span class="text-dim" style="font-size:0.78rem">${t("favorites_price_max", lang)}</span>
          <input type="number" class="favorites-price-max" min="0" value="${fav.price_max ?? ""}" />
        </label>
      </div>
      <button type="button" class="btn-primary favorites-save-btn" style="margin-top:10px">${t("favorites_save_button", lang)}</button>
      ${hasAnyFavorites(fav) ? `<p class="favorites-saved-note">${t("favorites_active_note", lang)}</p>` : ""}
    </div>
  `;
}

export async function renderSettings(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const [{ data, isSample }, { data: candidatesData }, fav] = await Promise.all([loadMeta(), loadCandidates(), getFavorites()]);
  const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";

  const categoryKeys = [...new Set(candidatesData.candidates.map((c) => c.category))].sort();
  const categories = categoryKeys.map((key) => ({
    key,
    label: resolveCategoryLabel(key, lang, lang === "es" ? candidatesData.candidates.find((c) => c.category === key)?.category_label_es : candidatesData.candidates.find((c) => c.category === key)?.category_label_en),
  }));
  const brandCounts = new Map<string, number>();
  for (const c of candidatesData.candidates) {
    if (!c.shop_name) continue;
    brandCounts.set(c.shop_name, (brandCounts.get(c.shop_name) ?? 0) + 1);
  }
  const brands = [...brandCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  container.innerHTML = `
    ${banner}
    <h2 class="view-title">${t("settings_title", lang)}</h2>
    <div class="insight-card">
      <h3>${t("credits_title", lang)}</h3>
      <div class="stat-row">
        <div class="stat"><b>${data.credits_balance}</b><span>${t("credits_remaining", lang)}</span></div>
        <div class="stat"><b>${data.credits_used_month}</b><span>${t("credits_used_month", lang)}</span></div>
        <div class="stat"><b>${data.credits_used_this_week}</b><span>${t("credits_used_week", lang)}</span></div>
      </div>
      <div style="font-size:0.75rem;color:var(--text-dim);margin-top:6px">
        ${t("weights_version", lang)}: ${data.weights_version} &middot; ${t("last_run", lang)}: ${new Date(data.run_at).toLocaleString(locale(lang))}
      </div>
    </div>
    ${favoritesSectionHtml(fav, categories, brands, lang)}
    <div class="insight-card">
      <p style="font-size:0.85rem;color:var(--text-dim)">${t("settings_coming_soon", lang)}</p>
    </div>
  `;

  let pendingCategories = new Set(fav.categories);
  let pendingBrands = new Set(fav.brands);
  container.querySelectorAll<HTMLButtonElement>("[data-fav-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.favCategory!;
      if (pendingCategories.has(key)) pendingCategories.delete(key);
      else pendingCategories.add(key);
      btn.classList.toggle("active");
    });
  });
  container.querySelectorAll<HTMLButtonElement>("[data-fav-brand]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.favBrand!;
      if (pendingBrands.has(name)) pendingBrands.delete(name);
      else pendingBrands.add(name);
      btn.classList.toggle("active");
    });
  });
  container.querySelector<HTMLButtonElement>(".favorites-save-btn")?.addEventListener("click", () => {
    const priceMinInput = container.querySelector<HTMLInputElement>(".favorites-price-min");
    const priceMaxInput = container.querySelector<HTMLInputElement>(".favorites-price-max");
    const next: Favorites = {
      categories: [...pendingCategories],
      brands: [...pendingBrands],
      price_min: priceMinInput?.value ? Number(priceMinInput.value) : null,
      price_max: priceMaxInput?.value ? Number(priceMaxInput.value) : null,
    };
    saveFavorites(next);
    void renderSettings(container, lang);
  });
}
