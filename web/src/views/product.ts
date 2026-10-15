import { loadProduct } from "../api";
import { assetUrl } from "../asset";
import { t, type Lang } from "../i18n";
import type { VideoCard } from "../types";

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

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

function videoEmbed(video: VideoCard, lang: Lang): string {
  // The fallback (thumbnail + link) renders alongside the embed every time,
  // not just on failure -- watchEmbed() below hides whichever one didn't
  // end up working, so a slow network, an ad blocker, or a removed TikTok
  // video never leaves an empty gap (added 2026-10-17).
  return `
    <div class="video-embed-card" data-video-id="${video.video_id}">
      <a class="video-fallback" href="${video.tiktok_url}" target="_blank" rel="noopener">
        ${video.cover_url ? `<img src="${assetUrl(video.cover_url)}" alt="" loading="lazy" />` : ""}
        <span class="video-fallback-play">&#9654;</span>
        <span class="video-fallback-label">${t("open_in_tiktok", lang)}</span>
      </a>
      <blockquote class="tiktok-embed" cite="${video.tiktok_url}" data-video-id="${video.video_id}" style="max-width: 325px; min-width: 220px;">
        <section></section>
      </blockquote>
      <div class="video-embed-stats">
        <span>${formatCount(video.play_count)} ${t("views_short", lang)}</span>
        <span>${video.window_units_sold} ${t("sales_short", lang)}</span>
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

/** Shows the thumbnail+link fallback until (and unless) TikTok's embed.js
 * actually turns the blockquote into a playable iframe -- it inserts the
 * iframe as a child of the blockquote itself (confirmed live), so a
 * MutationObserver on the blockquote is enough to detect success. Gives up
 * after 6s (network blocked, ad blocker, video removed) and leaves the
 * fallback as the permanent display. */
function watchEmbed(card: HTMLElement): void {
  const blockquote = card.querySelector<HTMLElement>(".tiktok-embed");
  const fallback = card.querySelector<HTMLElement>(".video-fallback");
  if (!blockquote || !fallback) return;

  const onLoaded = () => {
    fallback.style.display = "none";
  };
  if (blockquote.querySelector("iframe")) {
    onLoaded();
    return;
  }

  const observer = new MutationObserver(() => {
    if (blockquote.querySelector("iframe")) {
      onLoaded();
      observer.disconnect();
    }
  });
  observer.observe(blockquote, { childList: true, subtree: true });

  setTimeout(() => {
    observer.disconnect();
    if (!blockquote.querySelector("iframe")) {
      blockquote.style.display = "none";
    }
  }, 6000);
}

function statBox(value: string, label: string): string {
  return `<div class="stat-box"><b>${value}</b><span>${label}</span></div>`;
}

export async function renderProduct(container: HTMLElement, lang: Lang, productId: string): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  try {
    const { data, isSample } = await loadProduct(productId);
    const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";
    const path = sparklinePath(data.daily_units_14, 280, 60);
    const categoryLabel = lang === "es" ? data.category_label_es : data.category_label_en;

    const statBoxes = [
      statBox(formatCount(data.units_7d), t("sold_this_week", lang)),
      statBox(formatCount(data.units_total), t("total_sales", lang)),
      statBox(`${(data.commission_rate * 100).toFixed(0)}%`, t("commission", lang)),
      statBox(`$${data.earnings_per_sale.toFixed(2)}`, t("per_sale", lang)),
    ];
    if (data.creator_count !== null) statBoxes.push(statBox(formatCount(data.creator_count), t("creators_selling", lang)));
    if (data.video_count !== null) statBoxes.push(statBox(formatCount(data.video_count), t("videos_count_label", lang)));

    container.innerHTML = `
      ${banner}
      <a class="back-link" href="#/week">&larr; ${t("back_to_week", lang)}</a>
      <div class="product-gallery">
        ${data.image_url ? `<img src="${assetUrl(data.image_url)}" alt="${data.title}" />` : ""}
      </div>
      <h2 class="view-title product-title">${data.title}</h2>
      <div style="text-align:center;font-size:0.8rem;color:var(--text-dim);margin:-8px 0 12px">${categoryLabel} &middot; ${data.shop_name}</div>
      <div style="text-align:center;font-size:1.3rem;font-weight:700;margin-bottom:12px">$${data.price.toFixed(2)}</div>
      <div class="stat-box-grid">${statBoxes.join("")}</div>
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
      <div class="free-buttons">
        <a href="${data.tiktok_search_url}" target="_blank" rel="noopener" class="btn-accent">${t("tiktok_videos_button", lang)}</a>
        <a href="${data.fastmoss_url}" target="_blank" rel="noopener">${t("open_in_fastmoss", lang)}</a>
      </div>
    `;
    if (data.videos.length > 0) {
      loadTikTokEmbedScript();
      container.querySelectorAll<HTMLElement>(".video-embed-card").forEach(watchEmbed);
    }
  } catch {
    container.innerHTML = `<p class="empty-state">${t("product_not_found", lang)}</p>`;
  }
}
