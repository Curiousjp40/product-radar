import { loadMeta } from "../api";
import { t, type Lang } from "../i18n";

export async function renderSettings(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const { data, isSample } = await loadMeta();
  const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";

  container.innerHTML = `
    ${banner}
    <h2 class="view-title">${t("settings_title", lang)}</h2>
    <div class="insight-card">
      <h3>${lang === "es" ? "Creditos de FastMoss" : "FastMoss credits"}</h3>
      <div class="stat-row">
        <div class="stat"><b>${data.credits_balance}</b><span>${lang === "es" ? "Restantes" : "Remaining"}</span></div>
        <div class="stat"><b>${data.credits_used_month}</b><span>${lang === "es" ? "Usados este mes" : "Used this month"}</span></div>
        <div class="stat"><b>${data.credits_used_this_week}</b><span>${lang === "es" ? "Esta semana" : "This week"}</span></div>
      </div>
      <div style="font-size:0.75rem;color:var(--text-dim);margin-top:6px">
        ${lang === "es" ? "Version de pesos" : "Weights version"}: ${data.weights_version} &middot; ${lang === "es" ? "Ultima corrida" : "Last run"}: ${new Date(data.run_at).toLocaleString()}
      </div>
    </div>
    <div class="insight-card">
      <p style="font-size:0.85rem;color:var(--text-dim)">${t("settings_coming_soon", lang)}</p>
    </div>
  `;
}
