import { loadProduct } from "../api";
import { t, type Lang } from "../i18n";

export async function renderProduct(container: HTMLElement, lang: Lang, productId: string): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  try {
    const { data, isSample } = await loadProduct(productId);
    const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";
    container.innerHTML = `
      ${banner}
      <h2 class="view-title">${data.title}</h2>
      <div class="insight-card">
        <div class="stat-row">
          <div class="stat"><b>$${data.price.toFixed(2)}</b><span>${t("price", lang)}</span></div>
          <div class="stat"><b>${(data.commission_rate * 100).toFixed(0)}%</b><span>${t("commission", lang)}</span></div>
          <div class="stat"><b>${(data.spanish_share * 100).toFixed(0)}%</b><span>Spanish videos</span></div>
        </div>
      </div>
      <div class="insight-card">
        <h3>${lang === "es" ? "Historial semanal" : "Weekly history"}</h3>
        <div class="table-scroll">
          <table class="radar-table">
            <thead><tr><th>${lang === "es" ? "Semana" : "Week"}</th><th>Rank</th><th>Units/7d</th><th>Creators</th></tr></thead>
            <tbody>
              ${data.weekly_history
                .map((w) => `<tr><td>${w.week}</td><td>${w.rank}</td><td>${w.units_7d}</td><td>${w.creator_count}</td></tr>`)
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
      <div class="insight-card">
        <h3>${lang === "es" ? "Videos principales" : "Top videos"}</h3>
        <ul class="reasons">
          ${data.top_videos
            .map(
              (v) =>
                `<li><a href="${v.url}" target="_blank" rel="noopener" style="color:var(--accent-2)">${v.url}</a> ${v.is_spanish ? "(ES)" : "(EN)"} - ${v.views.toLocaleString()} views</li>`,
            )
            .join("")}
        </ul>
      </div>
    `;
  } catch {
    container.innerHTML = `<p class="empty-state">${t("no_data", lang)}</p>`;
  }
}
