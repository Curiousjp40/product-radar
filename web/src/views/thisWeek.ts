import { loadPicks } from "../api";
import { t, type Lang } from "../i18n";
import { getAllFeedback, getAllStatuses, setStatus } from "../pipeline";
import type { Pick } from "../types";

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function tagLabel(stage: string, lang: Lang): string {
  return t(`tag_${stage}`, lang);
}

function summaryFor(pick: Pick, lang: Lang): string {
  return lang === "es" ? pick.summary_es : pick.summary_en;
}

function renderCard(pick: Pick, lang: Lang, statuses: Record<string, string>, dismissed: Set<string>): string {
  const isDismissed = dismissed.has(pick.product_id);
  const saved = statuses[pick.product_id] === "shortlisted";
  const earnLine = t("earn_headline", lang, { amount: pick.earnings_per_sale.toFixed(2) });
  const videos = pick.videos.slice(0, 3);

  return `
    <article class="pick-card" data-product-id="${pick.product_id}" style="${isDismissed ? "opacity:0.4" : ""}">
      <a class="card-photo-link" href="#/product/${pick.product_id}">
        ${pick.image_url ? `<img class="card-photo" src="${pick.image_url}" alt="${pick.clean_title}" loading="lazy" />` : `<div class="card-photo card-photo-placeholder"></div>`}
      </a>
      <div class="card-body">
        <h3 class="card-title">${pick.clean_title}</h3>
        <div class="card-earn">${earnLine}</div>
        <div class="card-tags">
          <span class="tag tag-${pick.stage}">${tagLabel(pick.stage, lang)}</span>
          <span class="tag tag-price">$${pick.price.toFixed(2)}</span>
        </div>
        ${summaryFor(pick, lang) ? `<p class="card-summary">${summaryFor(pick, lang)}</p>` : ""}
        ${
          videos.length > 0
            ? `<div class="card-videos">
                ${videos
                  .map(
                    (v) => `
                  <a class="video-thumb" href="${v.tiktok_url}" target="_blank" rel="noopener">
                    ${v.cover_url ? `<img src="${v.cover_url}" alt="" loading="lazy" />` : `<div class="video-thumb-placeholder"></div>`}
                    <span class="video-views">${formatCount(v.play_count)} ${t("views_short", lang)}</span>
                  </a>`,
                  )
                  .join("")}
              </div>`
            : ""
        }
        <div class="card-actions">
          <a class="btn-primary" href="#/product/${pick.product_id}">${t("see_details", lang)}</a>
          <button class="btn-heart ${saved ? "active" : ""}" data-action="shortlist" aria-label="${t("save_to_list", lang)}">${saved ? "♥" : "♡"}</button>
        </div>
      </div>
    </article>
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
  container.innerHTML = `
    ${banner}
    <div class="card-grid">${data.picks.map((p) => renderCard(p, lang, statuses, dismissed)).join("")}</div>
  `;
  container.querySelectorAll<HTMLElement>(".pick-card").forEach((card) => {
    const productId = card.dataset.productId!;
    card.querySelector('[data-action="shortlist"]')?.addEventListener("click", (e) => {
      const heart = e.currentTarget as HTMLButtonElement;
      heart.classList.add("active");
      heart.textContent = "♥";
      void setStatus(productId, "shortlisted");
    });
  });
}
