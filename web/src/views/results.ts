import { loadInsights } from "../api";
import { t, type Lang } from "../i18n";
import type { CreatorInsights } from "../types";

function lengthSweetSpotTable(insights: CreatorInsights, lang: Lang): string {
  const order = ["<=12s", "13-20s", "21-30s", "31s+"];
  const rows = order.filter((b) => insights.length_sweet_spot[b]);
  if (rows.length === 0) return `<p class="empty-state">${t("no_data", lang)}</p>`;
  return `
    <table class="radar-table">
      <thead><tr><th>${lang === "es" ? "Duracion" : "Length"}</th><th>${lang === "es" ? "GMV/video" : "GMV/video"}</th><th>${lang === "es" ? "Unidades/10K vistas" : "Units/10K views"}</th></tr></thead>
      <tbody>
        ${rows
          .map((b) => {
            const s = insights.length_sweet_spot[b];
            return `<tr><td>${b}</td><td>$${s.gmv_per_video.toFixed(0)}</td><td>${s.units_per_10k_views.toFixed(1)}</td></tr>`;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function summaryStats(insights: CreatorInsights, lang: Lang): string {
  const s = insights.summary;
  return `
    <div class="stat-row">
      <div class="stat"><b>$${s.gmv.toFixed(0)}</b><span>GMV</span></div>
      <div class="stat"><b>${s.units}</b><span>Units</span></div>
      <div class="stat"><b>$${s.avg_price_per_unit.toFixed(2)}</b><span>${lang === "es" ? "Precio/unidad" : "Price/unit"}</span></div>
      <div class="stat"><b>$${s.gmv_per_1k_views.toFixed(2)}</b><span>GMV/1K views</span></div>
      <div class="stat"><b>${(insights.hit_tracker.gmv_top1_share * 100).toFixed(0)}%</b><span>${t("top1_share", lang)}</span></div>
      <div class="stat"><b>${(insights.hit_tracker.gmv_top5_share * 100).toFixed(0)}%</b><span>${t("top5_share", lang)}</span></div>
      <div class="stat"><b>${insights.hit_tracker.videos_per_week.toFixed(1)}</b><span>${t("videos_per_week", lang)}</span></div>
    </div>
  `;
}

export async function renderResults(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const { data, isSample } = await loadInsights();
  const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";
  const roxie = data.roxm___;
  const ari = data.ariannamendoza04;

  container.innerHTML = `
    ${banner}
    <h2 class="view-title">${t("results_title", lang)}</h2>

    <div class="insight-card">
      <h3>Roxie</h3>
      ${summaryStats(roxie, lang)}
    </div>

    <div class="insight-card">
      <h3>${t("length_sweet_spot", lang)}</h3>
      ${lengthSweetSpotTable(roxie, lang)}
    </div>

    <div class="insight-card">
      <h3>${t("benchmark", lang)}</h3>
      <div class="table-scroll">
        <table class="radar-table">
          <thead><tr><th></th><th>Roxie</th><th>Ari</th></tr></thead>
          <tbody>
            <tr><td>GMV</td><td>$${roxie.summary.gmv.toFixed(0)}</td><td>$${ari.summary.gmv.toFixed(0)}</td></tr>
            <tr><td>${lang === "es" ? "Precio/unidad" : "Price/unit"}</td><td>$${roxie.summary.avg_price_per_unit.toFixed(2)}</td><td>$${ari.summary.avg_price_per_unit.toFixed(2)}</td></tr>
            <tr><td>GMV/1K views</td><td>$${roxie.summary.gmv_per_1k_views.toFixed(2)}</td><td>$${ari.summary.gmv_per_1k_views.toFixed(2)}</td></tr>
            <tr><td>${t("videos_per_week", lang)}</td><td>${roxie.hit_tracker.videos_per_week.toFixed(1)}</td><td>${ari.hit_tracker.videos_per_week.toFixed(1)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}
