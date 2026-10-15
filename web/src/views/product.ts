import { loadProduct } from "../api";
import { assetUrl } from "../asset";
import { earningsPerHour } from "../effortPay";
import { t, type Lang } from "../i18n";
import { hasRequestedSample, requestSample } from "../samples";
import type { FormulaGanadora, VideoCard } from "../types";

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
        <span>$${video.window_gmv.toFixed(0)}</span>
        <span>@${video.creator_handle}</span>
        ${video.is_ad ? `<span class="ad-tag">${t("ad_tag", lang)}</span>` : ""}
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

// "7-9 PM" style: 24h hour -> 12h, condensed to one AM/PM suffix when both
// ends share it (the common case), e.g. 19/21 -> "7-9 PM".
function formatHourRange(hourStart: number, hourEnd: number): string {
  const to12 = (h: number) => (h % 12 === 0 ? 12 : h % 12);
  const period = (h: number) => (h < 12 ? "AM" : "PM");
  const startPeriod = period(hourStart);
  const endPeriod = period(hourEnd);
  if (startPeriod === endPeriod) return `${to12(hourStart)}-${to12(hourEnd)} ${startPeriod}`;
  return `${to12(hourStart)} ${startPeriod} - ${to12(hourEnd)} ${endPeriod}`;
}

function formulaGanadoraHtml(formula: FormulaGanadora, lang: Lang): string {
  const duration =
    formula.ideal_duration.seconds !== null
      ? t("ideal_duration_seconds", lang, { seconds: formula.ideal_duration.seconds })
      : t("ideal_duration_range", lang, {
          lo: formula.ideal_duration.sweet_spot_range[0],
          hi: formula.ideal_duration.sweet_spot_range[1],
        });
  const stats = formula.format_stats;
  return `
    <div class="insight-card formula-ganadora">
      <h3>${t("formula_ganadora_title", lang)}</h3>
      ${
        formula.top_hashtags.length > 0
          ? `<div class="formula-section">
              <div class="formula-section-head">
                <span class="formula-label">${t("top_hashtags_label", lang)}</span>
                <button type="button" class="copy-hashtags-btn" data-hashtags="${formula.top_hashtags.map((h) => `#${h.hashtag}`).join(" ")}">${t("copy_all_button", lang)}</button>
              </div>
              <div class="hashtag-chips">${formula.top_hashtags.map((h) => `<span class="hashtag-chip">#${h.hashtag}</span>`).join("")}</div>
            </div>`
          : ""
      }
      <div class="formula-section">
        <span class="formula-label">${t("ideal_duration_label", lang)}</span>
        <div class="formula-value">${duration}</div>
      </div>
      <div class="formula-section">
        <span class="formula-label">${t("format_label", lang)}</span>
        <div class="formula-value">
          ${t("reply_stat_label", lang)}: ${stats.reply_pct}% &middot;
          ${t("price_mention_stat_label", lang)}: ${stats.price_mention_pct}% &middot;
          ${t("ad_stat_label", lang)}: ${stats.ad_pct}%
        </div>
      </div>
      ${
        formula.best_posting_hour
          ? `<div class="formula-section">
              <span class="formula-label">${t("best_hour_label", lang)}</span>
              <div class="formula-value">${formatHourRange(formula.best_posting_hour.hour_start, formula.best_posting_hour.hour_end)}</div>
            </div>`
          : ""
      }
      ${
        formula.top_hooks.length > 0
          ? `<div class="formula-section">
              <span class="formula-label">${t("hooks_label", lang)}</span>
              <ul class="hook-list">${formula.top_hooks.map((h) => `<li>&ldquo;${h}&rdquo;</li>`).join("")}</ul>
            </div>`
          : ""
      }
    </div>
  `;
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
    const perHour = earningsPerHour(data.earnings_per_sale, data.effort_minutes);
    if (perHour !== null) statBoxes.push(statBox(`$${perHour.toFixed(2)}`, t("earnings_per_hour_label", lang)));

    container.innerHTML = `
      ${banner}
      <a class="back-link" href="#/week">&larr; ${t("back_to_week", lang)}</a>
      <div class="product-gallery">
        ${data.image_url ? `<img src="${assetUrl(data.image_url)}" alt="${data.title}" />` : ""}
      </div>
      <h2 class="view-title product-title">${data.title}</h2>
      <div style="text-align:center;font-size:0.8rem;color:var(--text-dim);margin:-8px 0 12px">${categoryLabel} &middot; ${data.shop_name}</div>
      <div style="text-align:center;font-size:1.3rem;font-weight:700;margin-bottom:12px">$${data.price.toFixed(2)}</div>
      ${
        data.saturation_badge || data.pocas_creadoras_latinas
          ? `<div style="text-align:center;margin:-4px 0 12px">
              ${data.saturation_badge ? `<span class="saturation-badge saturation-${data.saturation_badge.level}">${t(`saturation_tag_${data.saturation_badge.level}`, lang)}</span>` : ""}
              ${data.pocas_creadoras_latinas ? `<span class="saturation-badge pocas-latinas-badge">${t("pocas_latinas_tag", lang)}</span>` : ""}
              ${data.saturation_badge ? `<p class="saturation-reason" style="text-align:center">${lang === "es" ? data.saturation_badge.reason_es : data.saturation_badge.reason_en}</p>` : ""}
              ${data.pocas_creadoras_latinas ? `<p class="saturation-reason" style="text-align:center">${t("pocas_latinas_reason", lang)}</p>` : ""}
            </div>`
          : ""
      }
      <div class="stat-box-grid">${statBoxes.join("")}</div>
      <p class="commission-note">${t("commission_open_note", lang)}</p>
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
      ${data.formula_ganadora ? formulaGanadoraHtml(data.formula_ganadora, lang) : ""}
      <div class="free-buttons">
        <a href="${data.tiktok_shop_url}" target="_blank" rel="noopener" class="btn-accent">${t("open_in_tiktok_shop", lang)}</a>
        <button
          type="button"
          class="btn-request-sample ${hasRequestedSample(data.product_id) ? "active" : ""}"
          data-action="request-sample"
          data-product-id="${data.product_id}"
          data-price="${data.price}"
          data-name="${data.clean_title.replace(/"/g, "&quot;")}"
          ${hasRequestedSample(data.product_id) ? "disabled" : ""}
        >${hasRequestedSample(data.product_id) ? t("sample_requested_label", lang) : t("request_sample_button", lang)}</button>
        <a href="${data.tiktok_search_url}" target="_blank" rel="noopener">${t("tiktok_videos_button", lang)}</a>
        <a href="${data.fastmoss_url}" target="_blank" rel="noopener">${t("open_in_fastmoss", lang)}</a>
      </div>
      <p class="free-buttons-note">${t("tiktok_search_note", lang)}</p>
    `;
    if (data.videos.length > 0) {
      loadTikTokEmbedScript();
      container.querySelectorAll<HTMLElement>(".video-embed-card").forEach(watchEmbed);
    }
    const sampleBtn = container.querySelector<HTMLButtonElement>('[data-action="request-sample"]');
    sampleBtn?.addEventListener("click", () => {
      const { productId, price, name } = sampleBtn.dataset;
      if (!productId) return;
      requestSample(productId, name ?? "", Number(price) || 0, new Date());
      sampleBtn.textContent = t("sample_requested_label", lang);
      sampleBtn.classList.add("active");
      sampleBtn.disabled = true;
    });
    const copyBtn = container.querySelector<HTMLButtonElement>(".copy-hashtags-btn");
    copyBtn?.addEventListener("click", () => {
      const text = copyBtn.dataset.hashtags ?? "";
      const originalLabel = copyBtn.textContent;
      navigator.clipboard
        .writeText(text)
        .then(() => {
          copyBtn.textContent = t("copied_label", lang);
          setTimeout(() => {
            copyBtn.textContent = originalLabel;
          }, 1500);
        })
        .catch(() => {
          // clipboard unavailable (permissions, insecure context) -- the
          // chips are still readable/tappable on their own, nothing breaks.
        });
    });
  } catch {
    container.innerHTML = `<p class="empty-state">${t("product_not_found", lang)}</p>`;
  }
}
