import { loadPicks } from "../api";
import { t, type Lang } from "../i18n";
import { getAllFeedback, getAllStatuses, setStatus } from "../pipeline";
import type { Pick } from "../types";
import { assetUrl } from "../asset";

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function summaryFor(pick: Pick, lang: Lang): string {
  return lang === "es" ? pick.summary_es : pick.summary_en;
}

// Same "7-9 PM" condensing as product.ts's formatHourRange -- duplicated
// rather than shared since it's a one-off one-liner, matching this
// codebase's existing per-file duplication of formatCount etc.
function formatHourRange(hourStart: number, hourEnd: number): string {
  const to12 = (h: number) => (h % 12 === 0 ? 12 : h % 12);
  const period = (h: number) => (h < 12 ? "AM" : "PM");
  const startPeriod = period(hourStart);
  const endPeriod = period(hourEnd);
  if (startPeriod === endPeriod) return `${to12(hourStart)}-${to12(hourEnd)} ${startPeriod}`;
  return `${to12(hourStart)} ${startPeriod} - ${to12(hourEnd)} ${endPeriod}`;
}

// Left-column compact row (Part F split view). Saturation badge (Part E)
// and "Pocas latinas" badge (Part H5) get added to .week-row-meta once
// those parts exist -- the data isn't there yet.
function rowHtml(pick: Pick, lang: Lang, dismissed: boolean, selected: boolean): string {
  const earnLine = t("earn_headline", lang, { amount: pick.earnings_per_sale.toFixed(2) });
  return `
    <a class="week-row ${selected ? "selected" : ""}" href="#/product/${pick.product_id}" data-product-id="${pick.product_id}" style="${dismissed ? "opacity:0.4" : ""}">
      ${pick.image_url ? `<img class="week-row-photo" src="${assetUrl(pick.image_url)}" alt="" loading="lazy" />` : `<div class="week-row-photo week-row-photo-placeholder"></div>`}
      <div class="week-row-body">
        <div class="week-row-title">${pick.clean_title}</div>
        <div class="week-row-meta">
          <span class="week-row-earn">${earnLine}</span>
          <span class="week-row-price">$${pick.price.toFixed(2)}</span>
        </div>
      </div>
    </a>
  `;
}

// Right-column sticky detail panel (desktop only, see .week-detail in
// styles.css). No image here exceeds 320px (photo) or 140px (video thumbs).
function detailHtml(pick: Pick, lang: Lang, saved: boolean): string {
  const categoryLabel = lang === "es" ? pick.category_label_es : pick.category_label_en;
  const earnLine = t("earn_headline", lang, { amount: pick.earnings_per_sale.toFixed(2) });
  const summary = summaryFor(pick, lang);
  const videos = pick.videos.slice(0, 3);
  const formula = pick.formula_ganadora;
  const topHashtags = formula?.top_hashtags.slice(0, 5) ?? [];
  const topHook = formula?.top_hooks[0];
  const bestHour = formula?.best_posting_hour;

  return `
    <div class="week-detail-inner">
      <div class="week-detail-photo-wrap">
        ${pick.image_url ? `<img class="week-detail-photo" src="${assetUrl(pick.image_url)}" alt="${pick.clean_title}" />` : `<div class="week-detail-photo week-detail-photo-placeholder"></div>`}
      </div>
      <h3 class="week-detail-title">${pick.clean_title}</h3>
      <div class="week-detail-earn">${earnLine}</div>
      <div class="week-detail-meta">
        $${pick.price.toFixed(2)} &middot; ${(pick.commission_rate * 100).toFixed(0)}% ${t("commission", lang)} &middot; ${categoryLabel}
      </div>
      ${summary ? `<p class="week-detail-summary">${summary}</p>` : ""}
      ${
        videos.length > 0
          ? `<div class="week-detail-videos">
              ${videos
                .map(
                  (v) => `
                <a class="video-thumb week-detail-thumb" href="${v.tiktok_url}" target="_blank" rel="noopener">
                  ${v.cover_url ? `<img src="${assetUrl(v.cover_url)}" alt="" loading="lazy" />` : `<div class="video-thumb-placeholder"></div>`}
                  ${v.is_ad ? `<span class="video-ad-tag">${t("ad_tag", lang)}</span>` : ""}
                  <span class="video-views">${formatCount(v.play_count)} ${t("views_short", lang)} &middot; ${v.window_units_sold} ${t("sales_short", lang)}</span>
                </a>`,
                )
                .join("")}
            </div>`
          : ""
      }
      ${
        topHashtags.length > 0
          ? `<div class="formula-section">
              <div class="formula-section-head">
                <span class="formula-label">${t("top_hashtags_label", lang)}</span>
                <button type="button" class="copy-hashtags-btn" data-hashtags="${topHashtags.map((h) => `#${h.hashtag}`).join(" ")}">${t("copy_all_button", lang)}</button>
              </div>
              <div class="hashtag-chips">${topHashtags.map((h) => `<span class="hashtag-chip">#${h.hashtag}</span>`).join("")}</div>
            </div>`
          : ""
      }
      ${
        topHook
          ? `<div class="formula-section">
              <span class="formula-label">${t("hooks_label", lang)}</span>
              <div class="formula-value">&ldquo;${topHook}&rdquo;</div>
            </div>`
          : ""
      }
      ${
        bestHour
          ? `<div class="formula-section">
              <span class="formula-label">${t("best_hour_label", lang)}</span>
              <div class="formula-value">${formatHourRange(bestHour.hour_start, bestHour.hour_end)}</div>
            </div>`
          : ""
      }
      <div class="card-actions week-detail-actions">
        <button type="button" class="btn-save-pill ${saved ? "active" : ""}" data-action="shortlist" aria-label="${t("save_to_list", lang)}">
          <span aria-hidden="true">${saved ? "♥" : "♡"}</span> ${saved ? t("guardado_label", lang) : t("guardar_button", lang)}
        </button>
        <a class="btn-primary" href="#/product/${pick.product_id}">${t("ver_todos_detalles_button", lang)}</a>
      </div>
    </div>
  `;
}

export async function renderThisWeek(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const { data, isSample } = await loadPicks();
  const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";
  if (data.picks.length === 0) {
    container.innerHTML = `${banner}<p class="empty-state">${t("no_data", lang)}</p>`;
    return;
  }
  const [statuses, feedback] = await Promise.all([getAllStatuses(), getAllFeedback()]);
  const dismissed = new Set(Object.keys(feedback).filter((id) => feedback[id] === "not_for_me"));
  const picksById = new Map(data.picks.map((p) => [p.product_id, p]));

  function wireDetail(detailEl: HTMLElement, productId: string): void {
    detailEl.querySelector('[data-action="shortlist"]')?.addEventListener("click", (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      statuses[productId] = "shortlisted";
      void setStatus(productId, "shortlisted");
      renderDetail(productId);
      btn.blur();
    });
    const copyBtn = detailEl.querySelector<HTMLButtonElement>(".copy-hashtags-btn");
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
          // clipboard unavailable -- chips are still readable on their own
        });
    });
  }

  function renderDetail(productId: string): void {
    const pick = picksById.get(productId);
    const detailEl = container.querySelector<HTMLElement>(".week-detail");
    if (!pick || !detailEl) return;
    const saved = statuses[pick.product_id] === "shortlisted";
    detailEl.innerHTML = detailHtml(pick, lang, saved);
    wireDetail(detailEl, pick.product_id);
  }

  function selectRow(productId: string): void {
    container.querySelectorAll<HTMLElement>(".week-row").forEach((row) => {
      row.classList.toggle("selected", row.dataset.productId === productId);
    });
    renderDetail(productId);
  }

  const firstId = data.picks[0].product_id;
  container.innerHTML = `
    ${banner}
    <div class="week-split">
      <div class="week-list">${data.picks.map((p) => rowHtml(p, lang, dismissed.has(p.product_id), p.product_id === firstId)).join("")}</div>
      <div class="week-detail"></div>
    </div>
  `;
  renderDetail(firstId);

  container.querySelectorAll<HTMLElement>(".week-row").forEach((row) => {
    const id = row.dataset.productId!;
    row.addEventListener("click", (e) => {
      // Desktop (split view): select in place, no navigation. Phone/tablet:
      // the detail panel is hidden by CSS, so let the <a href> navigate to
      // the full product page instead.
      if (window.matchMedia("(min-width: 1024px)").matches) {
        e.preventDefault();
        selectRow(id);
      }
    });
  });
}
