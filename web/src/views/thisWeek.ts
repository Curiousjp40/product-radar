import { loadCandidates, loadHooks, loadPicks } from "../api";
import { bestVideoTimeHtml } from "../bestTime";
import { t, type Lang } from "../i18n";
import { categoryHidePromptHtml, countHiddenInCategory, wireCategoryHidePrompt } from "../hideProduct";
import { getAllFeedback, getAllStatuses, getHiddenCategories, setFeedback, setStatus } from "../pipeline";
import type { Candidate, ComboPair, Pick } from "../types";
import { assetUrl } from "../asset";
import { findCombos } from "../combos";
import { hasRequestedSample, requestSample } from "../samples";

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

// Left-column compact row (Part F split view).
function rowHtml(pick: Pick, lang: Lang, selected: boolean): string {
  const earnLine = t("earn_headline", lang, { amount: pick.earnings_per_sale.toFixed(2) });
  return `
    <div class="week-row ${selected ? "selected" : ""}" data-product-id="${pick.product_id}">
      <a class="week-row-link" href="#/product/${pick.product_id}" data-product-id="${pick.product_id}">
        ${pick.image_url ? `<img class="week-row-photo" src="${assetUrl(pick.image_url)}" alt="" loading="lazy" />` : `<div class="week-row-photo week-row-photo-placeholder"></div>`}
        <div class="week-row-body">
          <div class="week-row-title">${pick.clean_title}</div>
          <div class="week-row-meta">
            <span class="week-row-earn">${earnLine}</span>
            <span class="week-row-price">$${pick.price.toFixed(2)}</span>
            ${pick.saturation_badge ? `<span class="saturation-badge saturation-${pick.saturation_badge.level}">${t(`saturation_tag_${pick.saturation_badge.level}`, lang)}</span>` : ""}
            ${pick.pocas_creadoras_latinas ? `<span class="saturation-badge pocas-latinas-badge">${t("pocas_latinas_tag", lang)}</span>` : ""}
          </div>
        </div>
      </a>
      <button type="button" class="btn-not-for-me" data-action="not-for-me" data-product-id="${pick.product_id}" data-category="${pick.category}">${t("not_for_me_button", lang)}</button>
    </div>
  `;
}

// "Esta semana, todo lo demás": the rest of this week's candidates (not in
// the curated ~9 picks), grouped by category -- Part C3's "not just the
// curated picks" ask, without redefining what a "pick" is in the engine.
function allThisWeekHtml(candidates: Candidate[], excludeIds: Set<string>, lang: Lang): string {
  const rest = candidates.filter((c) => !excludeIds.has(c.product_id) && !c.suspicious);
  if (rest.length === 0) return "";
  const byCategory = new Map<string, Candidate[]>();
  for (const c of rest) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }
  const categories = [...byCategory.keys()].sort((a, b) => (byCategory.get(b)!.length - byCategory.get(a)!.length));
  return `
    <h3 class="view-title" style="margin-top:28px">${t("all_this_week_title", lang)}</h3>
    ${categories
      .map((cat) => {
        const items = byCategory.get(cat)!.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
        const label = lang === "es" ? items[0].category_label_es : items[0].category_label_en;
        return `
          <div class="week-category-group">
            <h4 class="week-category-group-title">${label}</h4>
            <div class="card-grid">
              ${items
                .map(
                  (c) => `
                <article class="pick-card">
                  <a class="card-photo-link" href="#/product/${c.product_id}">
                    ${c.image_url ? `<img class="card-photo" src="${assetUrl(c.image_url)}" alt="" loading="lazy" />` : `<div class="card-photo card-photo-placeholder"></div>`}
                  </a>
                  <div class="card-body">
                    <h3 class="card-title">${c.clean_title}</h3>
                    <div class="card-earn">${t("earn_headline", lang, { amount: c.earnings_per_sale.toFixed(2) })}</div>
                  </div>
                </article>`,
                )
                .join("")}
            </div>
          </div>
        `;
      })
      .join("")}
  `;
}

// H2 combos: shown above the split view when at least one complementary
// category pair both have a pick this week.
function combosHtml(
  picks: Pick[],
  comboPairs: ComboPair[],
  categoryFitKeywords: Record<string, string[]>,
  lang: Lang,
): string {
  const combos = findCombos(
    picks.map((p) => ({ product_id: p.product_id, category: p.category, clean_title: p.clean_title, earnings_per_sale: p.earnings_per_sale })),
    comboPairs,
    categoryFitKeywords,
  );
  if (combos.length === 0) return "";
  return `
    <div class="insight-card combos-card">
      <h3>${t("combos_title", lang)}</h3>
      ${combos
        .map(
          (c) => `
        <div class="combo-row">
          <div class="combo-names">${c.a.clean_title} + ${c.b.clean_title}</div>
          <div class="combo-idea">${lang === "es" ? c.idea_es : c.idea_en}</div>
          <div class="combo-earn">${t("combos_combined_earn", lang, { amount: `$${c.combinedEarnings.toFixed(2)}` })}</div>
        </div>`,
        )
        .join("")}
    </div>
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
        ${pick.saturation_badge ? `<span class="saturation-badge saturation-${pick.saturation_badge.level}">${t(`saturation_tag_${pick.saturation_badge.level}`, lang)}</span>` : ""}
        ${pick.pocas_creadoras_latinas ? `<span class="saturation-badge pocas-latinas-badge">${t("pocas_latinas_tag", lang)}</span>` : ""}
      </div>
      ${pick.saturation_badge ? `<p class="saturation-reason">${lang === "es" ? pick.saturation_badge.reason_es : pick.saturation_badge.reason_en}</p>` : ""}
      ${pick.pocas_creadoras_latinas ? `<p class="saturation-reason">${t("pocas_latinas_reason", lang)}</p>` : ""}
      ${summary ? `<p class="week-detail-summary">${summary}</p>` : ""}
      ${bestVideoTimeHtml(pick.best_video_time, lang)}
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
          : `<div class="week-detail-videos-empty">
              <p class="empty-state">${t("no_videos_analyzed_yet", lang)}</p>
              <a href="${pick.tiktok_search_url}" target="_blank" rel="noopener" class="btn-accent">${t("tiktok_videos_button", lang)}</a>
            </div>`
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
        <a class="btn-primary" href="${pick.tiktok_shop_url}" target="_blank" rel="noopener">${t("open_in_tiktok_shop", lang)}</a>
        <button
          type="button"
          class="btn-request-sample ${hasRequestedSample(pick.product_id) ? "active" : ""}"
          data-action="request-sample"
          data-product-id="${pick.product_id}"
          data-price="${pick.price}"
          data-name="${pick.clean_title.replace(/"/g, "&quot;")}"
          ${hasRequestedSample(pick.product_id) ? "disabled" : ""}
        >${hasRequestedSample(pick.product_id) ? t("sample_requested_label", lang) : t("request_sample_button", lang)}</button>
        <button type="button" class="btn-save-pill ${saved ? "active" : ""}" data-action="shortlist" aria-label="${t("save_to_list", lang)}">
          <span aria-hidden="true">${saved ? "♥" : "♡"}</span> ${saved ? t("guardado_label", lang) : t("guardar_button", lang)}
        </button>
        <a class="btn-save-pill" href="#/product/${pick.product_id}">${t("ver_todos_detalles_button", lang)}</a>
        <button type="button" class="btn-not-for-me" data-action="not-for-me" data-product-id="${pick.product_id}" data-category="${pick.category}">${t("not_for_me_button", lang)}</button>
      </div>
    </div>
  `;
}

export async function renderThisWeek(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const [{ data: rawData, isSample }, { data: hooks }, { data: candidatesData }] = await Promise.all([
    loadPicks(),
    loadHooks(),
    loadCandidates(),
  ]);
  const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";
  if (rawData.picks.length === 0) {
    container.innerHTML = `${banner}<p class="empty-state">${t("no_data", lang)}</p>`;
    return;
  }
  const [statuses, feedback] = await Promise.all([getAllStatuses(), getAllFeedback()]);
  const hiddenCategories = new Set(getHiddenCategories());
  const data = { ...rawData, picks: rawData.picks.filter((p) => feedback[p.product_id] !== "not_for_me" && !hiddenCategories.has(p.category)) };
  const categoryByProductId = new Map(rawData.picks.map((p) => [p.product_id, p.category]));
  if (data.picks.length === 0) {
    container.innerHTML = `${banner}<p class="empty-state">${t("no_data", lang)}</p>`;
    return;
  }
  const picksById = new Map(data.picks.map((p) => [p.product_id, p]));

  function wireDetail(detailEl: HTMLElement, productId: string): void {
    detailEl.querySelector('[data-action="shortlist"]')?.addEventListener("click", (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      statuses[productId] = "shortlisted";
      void setStatus(productId, "shortlisted");
      renderDetail(productId);
      btn.blur();
    });
    detailEl.querySelector<HTMLButtonElement>('[data-action="request-sample"]')?.addEventListener("click", (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const { price, name } = btn.dataset;
      requestSample(productId, name ?? "", Number(price) || 0, new Date());
      renderDetail(productId);
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
  const excludeIds = new Set(data.picks.map((p) => p.product_id));
  container.innerHTML = `
    ${banner}
    ${combosHtml(data.picks, hooks.combo_pairs, hooks.category_fit_keywords, lang)}
    <div class="week-split">
      <div class="week-list">${data.picks.map((p) => rowHtml(p, lang, p.product_id === firstId)).join("")}</div>
      <div class="week-detail"></div>
    </div>
    <div class="category-hide-prompt-slot"></div>
    ${allThisWeekHtml(candidatesData.candidates, excludeIds, lang)}
  `;
  renderDetail(firstId);

  container.querySelectorAll<HTMLElement>(".week-row-link").forEach((link) => {
    const id = link.dataset.productId!;
    link.addEventListener("click", (e) => {
      // Desktop (split view): select in place, no navigation. Phone/tablet:
      // the detail panel is hidden by CSS, so let the <a href> navigate to
      // the full product page instead.
      if (window.matchMedia("(min-width: 1024px)").matches) {
        e.preventDefault();
        selectRow(id);
      }
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-action="not-for-me"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { productId, category } = btn.dataset;
      if (!productId || !category) return;
      await setFeedback(productId, "not_for_me");
      const updatedFeedback = await getAllFeedback();
      if (!getHiddenCategories().includes(category) && countHiddenInCategory(updatedFeedback, categoryByProductId, category) >= 3) {
        const label = lang === "es" ? rawData.picks.find((p) => p.category === category)?.category_label_es : rawData.picks.find((p) => p.category === category)?.category_label_en;
        const slot = container.querySelector(".category-hide-prompt-slot");
        if (slot) {
          slot.innerHTML = categoryHidePromptHtml(category, label ?? category, lang);
          wireCategoryHidePrompt(container, () => void renderThisWeek(container, lang));
        }
      } else {
        void renderThisWeek(container, lang);
      }
    });
  });
}
