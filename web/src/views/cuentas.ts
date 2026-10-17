// Design review follow-up (Ryan): merge "Buscar cuenta" + "Comparar
// cuentas" into one "Cuentas" main tab with Buscar / Guardadas / Comparar
// sub-tabs, replacing both as entries in Mas. #/buscar and
// #/comparar-cuentas keep working as redirects (main.ts) so nothing that
// links to them breaks.
import { t, type Lang } from "../i18n";
import { assetUrl, IMG_FALLBACK } from "../asset";
import { getSavedProfiles, type SavedProfile } from "../savedProfiles";
import { renderBuscarCuenta } from "./buscarCuenta";
import { renderCompararCuentas } from "./compararCuentas";

export type CuentasSubTab = "buscar" | "guardadas" | "comparar";
const SUB_TABS: { value: CuentasSubTab; labelKey: string }[] = [
  { value: "buscar", labelKey: "cuentas_tab_buscar" },
  { value: "guardadas", labelKey: "cuentas_tab_guardadas" },
  { value: "comparar", labelKey: "cuentas_tab_comparar" },
];

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function savedProfileCardHtml(p: SavedProfile, lang: Lang): string {
  const date = new Date(p.saved_at);
  const dateLabel = Number.isNaN(date.getTime()) ? p.saved_at : date.toLocaleDateString(lang === "es" ? "es-419" : "en-US", { month: "short", day: "numeric" });
  return `
    <div class="pick-card saved-profile-card" data-open-profile="${p.handle}">
      ${p.avatar ? `<img class="saved-search-avatar" src="${assetUrl(p.avatar)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${IMG_FALLBACK}'" />` : `<div class="saved-search-avatar"></div>`}
      <div class="card-body">
        <h3 class="card-title">${p.nickname}</h3>
        <div class="meta">@${p.handle}</div>
        <div class="meta">${formatCount(p.follower_count)} ${t("followers_label", lang)}</div>
        <div class="meta">$${p.day28_gmv.toFixed(0)} ${t("sales_28d_label", lang)}</div>
        <div class="meta">${t("saved_search_date", lang, { date: dateLabel })}</div>
      </div>
    </div>
  `;
}

async function renderGuardadas(container: HTMLElement, lang: Lang): Promise<void> {
  const profiles = await getSavedProfiles();
  container.innerHTML =
    profiles.length === 0
      ? `<p class="empty-state">${t("cuentas_guardadas_empty", lang)}</p>`
      : `<div class="card-grid card-grid-wide">${profiles.map((p) => savedProfileCardHtml(p, lang)).join("")}</div>`;
  container.querySelectorAll<HTMLElement>("[data-open-profile]").forEach((el) => {
    el.addEventListener("click", () => {
      location.hash = `#/cuentas/buscar/${el.dataset.openProfile}`;
    });
  });
}

export async function renderCuentas(container: HTMLElement, lang: Lang, subTab: CuentasSubTab = "buscar", openHandle?: string): Promise<void> {
  container.innerHTML = `
    <h2 class="view-title">${t("nav_cuentas", lang)}</h2>
    <div class="group-tabs" role="tablist">
      ${SUB_TABS.map((tab) => `<a href="#/cuentas/${tab.value}" class="${tab.value === subTab ? "active" : ""}">${t(tab.labelKey, lang)}</a>`).join("")}
    </div>
    <div class="cuentas-sub-view"></div>
  `;
  const subView = container.querySelector<HTMLElement>(".cuentas-sub-view")!;
  if (subTab === "guardadas") {
    await renderGuardadas(subView, lang);
  } else if (subTab === "comparar") {
    await renderCompararCuentas(subView, lang);
  } else {
    renderBuscarCuenta(subView, lang, openHandle);
  }
}
