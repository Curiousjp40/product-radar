import { loadPicks } from "../api";
import { t, type Lang } from "../i18n";
import { getFeedback, getStatus, setFeedback, setStatus } from "../pipeline";
import type { Pick } from "../types";

function stageBadge(stage: string, lang: Lang): string {
  return `<span class="badge stage-${stage}">${t(`stage_${stage}`, lang)}</span>`;
}

function kindBadge(kind: string, lang: Lang): string {
  return `<span class="badge kind">${t(`kind_${kind}`, lang)}</span>`;
}

function reasonsFor(pick: Pick, lang: Lang): string[] {
  return lang === "es" ? pick.reasons_es : pick.reasons_en;
}

function renderCard(pick: Pick, lang: Lang): string {
  const dismissed = getFeedback(pick.product_id) === "not_for_me";
  const shortlisted = getStatus(pick.product_id) === "shortlisted";
  return `
    <article class="pick-card" data-product-id="${pick.product_id}" style="${dismissed ? "opacity:0.4" : ""}">
      <div class="top-row">
        <div>
          <h3>${pick.title}</h3>
          ${stageBadge(pick.stage, lang)} ${kindBadge(pick.kind, lang)}
        </div>
        <div class="score-pill">${pick.score}</div>
      </div>
      <div class="stat-row">
        <div class="stat"><b>$${pick.price.toFixed(2)}</b><span>${t("price", lang)}</span></div>
        <div class="stat"><b>${(pick.commission_rate * 100).toFixed(0)}%</b><span>${t("commission", lang)}</span></div>
        <div class="stat"><b>$${pick.earnings_per_sale.toFixed(2)}</b><span>${t("per_sale", lang)}</span></div>
        <div class="stat"><b>$${pick.ev_typical.toFixed(0)}</b><span>${t("ev_typical", lang)}</span></div>
        <div class="stat"><b>$${pick.ev_upside.toFixed(0)}</b><span>${t("ev_upside", lang)}</span></div>
      </div>
      <ul class="reasons">${reasonsFor(pick, lang).map((r) => `<li>${r}</li>`).join("")}</ul>
      <div class="card-actions">
        <button class="btn-primary" data-action="shortlist">${shortlisted ? "✓" : ""} ${t("shortlist", lang)}</button>
        <button class="btn-secondary" data-action="not_for_me">${t("not_for_me", lang)}</button>
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
  container.innerHTML = `
    ${banner}
    <h2 class="view-title">${t("this_week_title", lang)}</h2>
    <div class="card-grid">${data.picks.map((p) => renderCard(p, lang)).join("")}</div>
  `;
  container.querySelectorAll<HTMLElement>(".pick-card").forEach((card) => {
    const productId = card.dataset.productId!;
    card.querySelector('[data-action="shortlist"]')?.addEventListener("click", () => {
      setStatus(productId, "shortlisted");
      void renderThisWeek(container, lang);
    });
    card.querySelector('[data-action="not_for_me"]')?.addEventListener("click", () => {
      setFeedback(productId, "not_for_me");
      void renderThisWeek(container, lang);
    });
  });
}
