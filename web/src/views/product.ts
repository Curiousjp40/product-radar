import { loadProduct } from "../api";
import { t, type Lang } from "../i18n";
import type { VideoCard } from "../types";

function sparklinePath(values: number[], width: number, height: number): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1 || 1);
  return values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function videoEmbed(video: VideoCard, lang: Lang): string {
  return `
    <div class="video-embed-card">
      <blockquote class="tiktok-embed" cite="${video.tiktok_url}" data-video-id="${video.video_id}" style="max-width: 325px; min-width: 220px;">
        <section></section>
      </blockquote>
      <div class="video-embed-stats">
        <span>${formatCount(video.play_count)} ${t("views_short", lang)}</span>
        <span>${video.window_units_sold} ${lang === "es" ? "ventas" : "sales"}</span>
      </div>
    </div>
  `;
}

function loadTikTokEmbedScript(): void {
  document.querySelectorAll('script[src="https://www.tiktok.com/embed.js"]').forEach((s) => s.remove());
  const script = document.createElement("script");
  script.src = "https://www.tiktok.com/embed.js";
  script.async = true;
  document.body.appendChild(script);
}

export async function renderProduct(container: HTMLElement, lang: Lang, productId: string): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  try {
    const { data, isSample } = await loadProduct(productId);
    const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";
    const path = sparklinePath(data.daily_units_14, 280, 60);

    container.innerHTML = `
      ${banner}
      <a class="back-link" href="#/week">&larr; ${t("back_to_week", lang)}</a>
      ${data.image_url ? `<img class="product-photo" src="${data.image_url}" alt="${data.title}" />` : ""}
      <h2 class="view-title product-title">${data.title}</h2>
      <div class="insight-card">
        <div class="stat-row">
          <div class="stat"><b>$${data.price.toFixed(2)}</b><span>${t("price", lang)}</span></div>
          <div class="stat"><b>${(data.commission_rate * 100).toFixed(0)}%</b><span>${t("commission", lang)}</span></div>
          <div class="stat"><b>$${data.earnings_per_sale.toFixed(2)}</b><span>${t("per_sale", lang)}</span></div>
        </div>
        <div style="font-size:0.8rem;color:var(--text-dim);margin-top:4px">${data.shop_name}</div>
      </div>
      ${
        data.daily_units_14.length > 0
          ? `<div class="insight-card">
              <h3>${t("sales_trend_title", lang)}</h3>
              <svg viewBox="0 0 280 60" class="sparkline" preserveAspectRatio="none">
                <path d="${path}" fill="none" stroke="var(--accent-2)" stroke-width="2" />
              </svg>
            </div>`
          : ""
      }
      ${
        data.videos.length > 0
          ? `<div class="insight-card">
              <h3>${t("videos_selling_title", lang)}</h3>
              <div class="video-embed-grid">${data.videos.map((v) => videoEmbed(v, lang)).join("")}</div>
            </div>`
          : ""
      }
      <a class="btn-primary product-fastmoss-link" href="${data.fastmoss_url}" target="_blank" rel="noopener">${t("open_in_fastmoss", lang)}</a>
    `;
    if (data.videos.length > 0) {
      loadTikTokEmbedScript();
    }
  } catch {
    container.innerHTML = `<p class="empty-state">${t("product_not_found", lang)}</p>`;
  }
}
