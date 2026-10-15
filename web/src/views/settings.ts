import { loadMeta } from "../api";
import { locale, t, type Lang } from "../i18n";

export async function renderSettings(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const { data, isSample } = await loadMeta();
  const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";

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
    <div class="insight-card">
      <p style="font-size:0.85rem;color:var(--text-dim)">${t("settings_coming_soon", lang)}</p>
    </div>
  `;
}
