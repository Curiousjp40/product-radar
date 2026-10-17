import { loadCandidates, loadMeta } from "../api";
import { categoryLabel as resolveCategoryLabel } from "../categoryLabels";
import { fetchCreditsSummary } from "../credits";
import { getFavorites, saveFavorites } from "../favorites";
import { hasAnyFavorites, type Favorites } from "../favoritesLogic";
import { locale, t, type Lang } from "../i18n";
import { applyLayoutClass, currentLayout, getLayoutOverride, setLayoutOverride, type LayoutOverride } from "../layoutDetect";

function formatCreditsResetDate(isoLike: string, lang: Lang): string {
  const date = new Date(isoLike.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return isoLike;
  return date.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { month: "short", day: "numeric" });
}

// Design review section 1b: manual "Vista" override (Automatica/Celular/
// Computadora), applied immediately (not just on next load) so switching
// feels live.
function vistaSectionHtml(lang: Lang): string {
  const current = getLayoutOverride();
  const options: { value: LayoutOverride; labelKey: string }[] = [
    { value: "auto", labelKey: "vista_auto" },
    { value: "mobile", labelKey: "vista_mobile" },
    { value: "desktop", labelKey: "vista_desktop" },
  ];
  return `
    <div class="insight-card">
      <h3>${t("vista_title", lang)}</h3>
      <p class="text-dim" style="font-size:0.8rem">${t("vista_intro", lang)}</p>
      <div class="favorites-chip-row">
        ${options.map((o) => `<button type="button" class="filter-chip ${current === o.value ? "active" : ""}" data-vista="${o.value}">${t(o.labelKey, lang)}</button>`).join("")}
      </div>
    </div>
  `;
}

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
    ${vistaSectionHtml(lang)}
    ${favoritesSectionHtml(fav, categories, brands, lang)}
    <div class="insight-card">
      <p style="font-size:0.85rem;color:var(--text-dim)">${t("settings_coming_soon", lang)}</p>
    </div>
    <details class="settings-admin-details">
      <summary>${t("settings_admin_title", lang)}</summary>
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
      <div class="insight-card credits-widget">
        <h3>${t("credits_widget_title", lang)}</h3>
        <p class="empty-state" style="padding:4px 0">...</p>
      </div>
    </details>
  `;

  container.querySelectorAll<HTMLButtonElement>("[data-vista]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.dataset.vista as LayoutOverride;
      setLayoutOverride(value);
      applyLayoutClass(currentLayout());
      void renderSettings(container, lang);
    });
  });

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

  void fetchCreditsSummary().then((summary) => {
    const widget = container.querySelector(".credits-widget");
    if (!widget) return;
    if (!summary) {
      widget.innerHTML = `<h3>${t("credits_widget_title", lang)}</h3><p class="empty-state" style="padding:4px 0">${t("credits_widget_unavailable", lang)}</p>`;
      return;
    }
    const total = summary.plan_credits_remaining + summary.topup_credits_remaining;
    const avgPerRun = data.avg_credits_per_run ?? null;
    const avgLine =
      avgPerRun !== null
        ? t("credits_widget_avg_per_run", lang, { n: Math.round(avgPerRun) })
        : t("credits_widget_avg_per_run_unknown", lang);
    widget.innerHTML = `
      <h3>${t("credits_widget_title", lang)}</h3>
      <p class="goal-progress-text">${t("credits_widget_remaining", lang, { n: total })}</p>
      <p class="goal-progress-text" style="color:var(--text-dim)">
        ${t("credits_widget_plan", lang, { n: summary.plan_credits_remaining })} &middot;
        ${t("credits_widget_topup", lang, { n: summary.topup_credits_remaining })}
      </p>
      <p class="goal-progress-text" style="color:var(--text-dim)">${t("credits_widget_reset", lang, { date: formatCreditsResetDate(summary.plan_expire_at, lang) })}</p>
      <p class="goal-progress-text" style="color:var(--text-dim)">${avgLine}</p>
    `;
  });
}
