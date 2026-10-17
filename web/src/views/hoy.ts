import { loadBestTimes, loadCandidates, loadHooks, loadPicks, loadSeasons } from "../api";
import { assetUrl, IMG_FALLBACK } from "../asset";
import { bestLiveTimeHtml, bestVideoTimeHtml } from "../bestTime";
import { categoryLabel as resolveCategoryLabel } from "../categoryLabels";
import { getEntries, getMonthlyGoal } from "../earningsGoal";
import { earningsProgress, earningsThisMonth } from "../earningsGoalLogic";
import { categoryHidePromptHtml, countHiddenInCategory, wireCategoryHidePrompt } from "../hideProduct";
import { t, type Lang } from "../i18n";
import { addMisProducto, getAllMisProductos, ownedProductIds, shopRejectionCount, solicitudFromProduct } from "../misProductos";
import { applyOwnedSwap } from "../ownedSwap";
import { candidateToPickStub } from "../pickAdapter";
import { clearFeedback, getAllFeedback, getAllStatuses, getHiddenCategories, setFeedback, setStatus } from "../pipeline";
import { showUndoToast } from "../toast";
import { productsToFilmToday, reorderForHero } from "../rotation";
import { weeklyUnitsChangePct } from "../cardMetrics";
import { getAllSamples, hasRequestedSample, requestSample } from "../samples";
import { hasUrgentSamples } from "../samplesLogic";
import type { HooksFile, LiveBestTime, Pick } from "../types";
import { yaLoTengoButtonHtml, yaLoTengoSheetHtml, wireYaLoTengo, type YaLoTengoProduct } from "../yaLoTengo";
import { goalCardHtml, wireGoalCard } from "./goalCard";
import { productCardInfoHtml } from "./productCard";
import { countdownText, groupSeasonEvents } from "./season";

function formatHourRange(hourStart: number, hourEnd: number): string {
  const to12 = (h: number) => (h % 12 === 0 ? 12 : h % 12);
  const period = (h: number) => (h < 12 ? "AM" : "PM");
  const startPeriod = period(hourStart);
  const endPeriod = period(hourEnd);
  if (startPeriod === endPeriod) return `${to12(hourStart)}-${to12(hourEnd)} ${startPeriod}`;
  return `${to12(hourStart)} ${startPeriod} - ${to12(hourEnd)} ${endPeriod}`;
}

// A deterministic-per-day pick from a list (e.g. "today's" template hook),
// using the same day-number approach as rotation.ts -- not random, so the
// suggestion doesn't flicker on every re-render, but still varies day to day.
function pickForToday<T>(items: T[], today: Date): T | null {
  if (items.length === 0) return null;
  const dayNumber = Math.floor(today.getTime() / 86_400_000);
  return items[dayNumber % items.length];
}

// Design review 3.13 / Ryan's placement fix: "Próxima temporada" card
// (current-or-next event, countdown, start-filming date, 3 matching
// product thumbnails from this week, link to the full #/temporadas
// calendar) replacing the one-line countdown banner and Temporadas' old
// spot in Mas.
async function seasonCardHtml(lang: Lang, picks: Pick[]): Promise<string> {
  const { data } = await loadSeasons();
  const groups = groupSeasonEvents(data.events);
  const ev = groups.ahora[0] ?? groups.proximo[0];
  if (!ev) return "";
  const label = lang === "es" ? ev.label_es : ev.label_en;
  const filmStartLine = ev.film_start ? t("season_start_filming", lang, { date: new Date(ev.film_start + "T00:00:00Z").toLocaleDateString(lang === "es" ? "es-419" : "en-US", { day: "numeric", month: "short", timeZone: "UTC" }) }) : "";
  const thumbs = picks
    .filter((p) => ev.categories.includes(p.category))
    .slice(0, 3)
    .map((p) => p.image_url);
  return `
    <a class="season-card hoy-season-card" href="#/temporadas">
      <h3 style="margin:0 0 4px">${label}</h3>
      <div class="countdown">${countdownText(ev, lang)}</div>
      ${filmStartLine ? `<div class="season-dates-line">${filmStartLine}</div>` : ""}
      ${
        thumbs.length > 0
          ? `<div class="hoy-season-thumbs">
              ${thumbs.map((url) => (url ? `<img src="${assetUrl(url)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${IMG_FALLBACK}'" />` : `<div class="hoy-season-thumb-placeholder"></div>`)).join("")}
            </div>`
          : ""
      }
      <span class="more-link">${t("season_view_calendar", lang)}</span>
    </a>
  `;
}

function bestHook(pick: Pick, hooks: HooksFile, today: Date, lang: Lang): string {
  const real = pick.formula_ganadora?.top_hooks[0];
  if (real) return real;
  const templates = hooks.hooks[pick.category]?.[lang] ?? [];
  return pickForToday(templates, today) ?? "";
}

function hashtagsHtml(pick: Pick, lang: Lang, limit: number): string {
  const tags = (pick.formula_ganadora?.top_hashtags ?? []).slice(0, limit);
  if (tags.length === 0) return "";
  return `
    <div class="hoy-hashtags">
      <div class="formula-section-head">
        <span class="formula-label">${t("top_hashtags_label", lang)}</span>
        <button type="button" class="copy-hashtags-btn" data-hashtags="${tags.map((h) => `#${h.hashtag}`).join(" ")}">${t("copy_all_button", lang)}</button>
      </div>
      <div class="hashtag-chips">${tags.map((h) => `<span class="hashtag-chip">#${h.hashtag}</span>`).join("")}</div>
    </div>
  `;
}

function shotListDetailsHtml(pick: Pick, hooks: HooksFile, lang: Lang): string {
  const archetype = hooks.category_to_shot_list[pick.category];
  const steps = archetype ? (hooks.shot_lists[archetype]?.[lang] ?? []) : [];
  if (steps.length === 0) return "";
  return `
    <details class="hoy-shot-list-details">
      <summary>${t("shot_list_label", lang)}</summary>
      <ol>${steps.map((s) => `<li>${s}</li>`).join("")}</ol>
    </details>
  `;
}

function actionButtons(pick: Pick, lang: Lang, filmed: boolean): string {
  const requested = hasRequestedSample(pick.product_id);
  return `
    <div class="card-actions">
      <a class="btn-primary" href="${pick.tiktok_shop_url}" target="_blank" rel="noopener">${t("open_in_tiktok_shop", lang)}</a>
      <a class="btn-save-pill" href="#/product/${pick.product_id}">${t("see_selling_videos_button", lang)}</a>
      <button
        type="button"
        class="btn-mark-filmed ${filmed ? "active" : ""}"
        data-action="mark-filmed"
        data-product-id="${pick.product_id}"
        ${filmed ? "disabled" : ""}
      >${filmed ? t("marked_filmed_label", lang) : t("mark_filmed_button", lang)}</button>
      <button
        type="button"
        class="btn-request-sample ${requested ? "active" : ""}"
        data-action="request-sample"
        data-product-id="${pick.product_id}"
        data-price="${pick.price}"
        data-name="${pick.clean_title.replace(/"/g, "&quot;")}"
        ${requested ? "disabled" : ""}
      >${requested ? t("sample_requested_label", lang) : t("request_sample_button", lang)}</button>
      <button type="button" class="btn-not-for-me" data-action="not-for-me" data-product-id="${pick.product_id}" data-category="${pick.category}">${t("not_for_me_button", lang)}</button>
      ${yaLoTengoButtonHtml(pick.product_id, lang)}
    </div>
  `;
}

function pickCardInput(pick: Pick) {
  return {
    earnings_per_sale: pick.earnings_per_sale,
    price: pick.price,
    commission_rate: pick.commission_rate,
    units_7d: pick.units_7d,
    daily_units_14: pick.daily_units_14,
    creator_count: pick.creator_count,
    ev_typical: pick.ev_typical,
    score: pick.score,
    saturation_badge: pick.saturation_badge,
  };
}

// The hero: one big "film this today" pick -- photo, the new "worth my
// time" info block, the one reason it's the pick, the best hook,
// hashtags, shot list behind a tap.
function heroHtml(
  pick: Pick,
  hooks: HooksFile,
  today: Date,
  lang: Lang,
  filmed: boolean,
  ownedIds: Set<string>,
  monthlyGoalRemaining: number | null,
  liveTime: LiveBestTime | null,
  liveCategoryLabel: string,
): string {
  const why = lang === "es" ? pick.summary_es : pick.summary_en;
  const hook = bestHook(pick, hooks, today, lang);
  const infoHtml = productCardInfoHtml(pickCardInput(pick), {
    lang,
    monthlyGoalRemaining,
    isOwned: ownedIds.has(pick.product_id),
    pocasLatinas: pick.pocas_creadoras_latinas,
    seasonEventLabel: lang === "es" ? pick.season_event_label_es : pick.season_event_label_en,
  });
  return `
    <article class="hoy-hero" data-product-id="${pick.product_id}">
      <a class="hoy-hero-photo-link" href="#/product/${pick.product_id}">
        ${pick.image_url ? `<img class="hoy-hero-photo" src="${assetUrl(pick.image_url)}" alt="${pick.clean_title}" loading="lazy" onerror="this.onerror=null;this.src='${IMG_FALLBACK}'" />` : `<div class="hoy-hero-photo hoy-hero-photo-placeholder"></div>`}
      </a>
      <div class="hoy-hero-body">
        <span class="hoy-hero-eyebrow">${t("hoy_hero_label", lang)}</span>
        <h3 class="hoy-hero-title">${pick.clean_title}</h3>
        ${infoHtml}
        ${why ? `<p class="hoy-hero-why">${why}</p>` : ""}
        ${hook ? `<p class="hoy-hook-real">&ldquo;${hook}&rdquo;</p>` : ""}
        ${bestVideoTimeHtml(pick.best_video_time, lang)}
        ${liveTime ? bestLiveTimeHtml(liveTime, liveCategoryLabel, lang) : ""}
        ${hashtagsHtml(pick, lang, 5)}
        ${shotListDetailsHtml(pick, hooks, lang)}
        ${actionButtons(pick, lang, filmed)}
      </div>
    </article>
  `;
}

// "Also good" -- smaller, condensed versions of the same card.
function alsoGoodCardHtml(
  pick: Pick,
  hooks: HooksFile,
  today: Date,
  lang: Lang,
  filmed: boolean,
  ownedIds: Set<string>,
  monthlyGoalRemaining: number | null,
): string {
  const hook = bestHook(pick, hooks, today, lang);
  const infoHtml = productCardInfoHtml(pickCardInput(pick), {
    lang,
    monthlyGoalRemaining,
    isOwned: ownedIds.has(pick.product_id),
    pocasLatinas: pick.pocas_creadoras_latinas,
    seasonEventLabel: lang === "es" ? pick.season_event_label_es : pick.season_event_label_en,
  });
  return `
    <article class="pick-card hoy-also-good" data-product-id="${pick.product_id}">
      <a class="card-photo-link" href="#/product/${pick.product_id}">
        ${pick.image_url ? `<img class="card-photo" src="${assetUrl(pick.image_url)}" alt="${pick.clean_title}" loading="lazy" onerror="this.onerror=null;this.src='${IMG_FALLBACK}'" />` : `<div class="card-photo card-photo-placeholder"></div>`}
      </a>
      <div class="card-body">
        <h3 class="card-title">${pick.clean_title}</h3>
        ${infoHtml}
        ${hook ? `<p class="hoy-hook-real">&ldquo;${hook}&rdquo;</p>` : ""}
        ${hashtagsHtml(pick, lang, 3)}
        ${shotListDetailsHtml(pick, hooks, lang)}
        ${actionButtons(pick, lang, filmed)}
      </div>
    </article>
  `;
}

export async function renderHoy(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const [{ data: picksData, isSample }, { data: hooks }, { data: candidatesData }, { data: bestTimes }, statuses, feedback, misProductos, goal, entries] =
    await Promise.all([
      loadPicks(),
      loadHooks(),
      loadCandidates(),
      loadBestTimes(),
      getAllStatuses(),
      getAllFeedback(),
      getAllMisProductos(),
      getMonthlyGoal(),
      getEntries(),
    ]);
  const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";
  const today = new Date();
  const ownedIds = ownedProductIds(misProductos);
  const progress = earningsProgress(goal, earningsThisMonth(entries, today));
  const monthlyGoalRemaining = progress ? progress.remaining : null;
  const hiddenCategories = new Set(getHiddenCategories());
  const eligiblePicks = picksData.picks.filter(
    (p) => feedback[p.product_id] !== "not_for_me" && !hiddenCategories.has(p.category),
  );
  // Part 3 "Ya lo tengo" (2026-10-16): an owned pick that still trended
  // back into this week's list surfaces as ONE "vuelve a grabarlo" card
  // below (max 1/day via pickForToday), while the normal swap drops every
  // owned pick from the rotation and backfills from the full candidate
  // pool so the list stays the same size.
  const resurgencePick = pickForToday(eligiblePicks.filter((p) => ownedIds.has(p.product_id)), today);
  const eligiblePickIds = new Set(eligiblePicks.map((p) => p.product_id));
  const candidatePool = [...candidatesData.candidates]
    .filter((c) => c.score !== null && !c.suspicious && !eligiblePickIds.has(c.product_id))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map(candidateToPickStub);
  const visiblePicks = applyOwnedSwap(eligiblePicks, candidatePool, ownedIds);
  const categoryByProductId = new Map(picksData.picks.map((p) => [p.product_id, p.category]));
  const postedIds = new Set(Object.entries(statuses).filter(([, s]) => s === "posted").map(([id]) => id));
  const allPickIds = visiblePicks.map((p) => p.product_id);
  const rotatedIds = productsToFilmToday(allPickIds, today, postedIds, 9);
  const byId = new Map(visiblePicks.map((p) => [p.product_id, p]));
  // Part C "hero fix" (2026-10-16): never lead with a falling-sales
  // product -- "Gradalo primero" should be her best flat-or-rising bet,
  // not whichever happened to land first in the day's rotation.
  const todaysIds = reorderForHero(rotatedIds, (id) => weeklyUnitsChangePct(byId.get(id)?.daily_units_14 ?? []));
  const todaysPicks = todaysIds.map((id) => byId.get(id)).filter((p): p is Pick => p !== undefined);
  const [hero, ...rest] = todaysPicks;

  const seasonHtml = await seasonCardHtml(lang, picksData.picks);
  const samplesBanner = hasUrgentSamples(getAllSamples(), today)
    ? `<a class="hoy-samples-banner" href="#/muestras">${t("hoy_samples_banner", lang)}</a>`
    : "";
  const resurgenceHtml = resurgencePick
    ? `<div class="ya-lo-tengo-resurgence">
         <strong>${t("ya_lo_tengo_resurgence_title", lang)}</strong>
         <p class="week-detail-summary">${resurgencePick.clean_title}</p>
         <a class="more-link" href="#/product/${resurgencePick.product_id}">${t("see_selling_videos_button", lang)}</a>
       </div>`
    : "";

  // "Tu proximo live" (Part B, 2026-10-16): the fuller plan lives on En
  // vivo -- this is just a day/time + 3 photos teaser, reusing the same
  // "category with the largest live sample" suggestion and the same
  // owned-first-then-top-fashion-picks product priority.
  const liveEntries = Object.entries(bestTimes.live ?? {}).filter((e): e is [string, LiveBestTime] => e[1] !== null);
  const suggestedLiveEntry = liveEntries.length > 0 ? liveEntries.reduce((best, e) => (e[1].sample_size > best[1].sample_size ? e : best)) : null;
  const ownedForLive = misProductos.filter((i) => i.status === "recibido" || i.status === "grabado").slice(0, 3);
  const livePhotoUrls =
    ownedForLive.length >= 3
      ? ownedForLive.map((i) => i.photo_url)
      : [...ownedForLive.map((i) => i.photo_url), ...picksData.picks.filter((p) => p.group === "fashion").map((p) => p.image_url)].slice(0, 3);
  const nextLiveHtml = suggestedLiveEntry
    ? `<a class="hoy-next-live" href="#/en-vivo">
         <strong>${t("en_vivo_plan_title", lang)}</strong>
         <p class="goal-progress-text">${t("en_vivo_plan_time", lang, { category: resolveCategoryLabel(suggestedLiveEntry[0], lang, lang === "es" ? picksData.picks.find((p) => p.category === suggestedLiveEntry[0])?.category_label_es : picksData.picks.find((p) => p.category === suggestedLiveEntry[0])?.category_label_en), days: suggestedLiveEntry[1].best_weekdays.map((d) => t(["weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri", "weekday_sat", "weekday_sun"][d], lang)).join(" / "), window: formatHourRange(suggestedLiveEntry[1].hour_start, suggestedLiveEntry[1].hour_end) })}</p>
         <div class="hoy-next-live-photos">
           ${livePhotoUrls
             .map((url) => (url ? `<img src="${assetUrl(url)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${IMG_FALLBACK}'" />` : `<div class="hoy-next-live-photo-placeholder"></div>`))
             .join("")}
         </div>
       </a>`
    : "";

  container.innerHTML = `
    ${banner}
    <h2 class="view-title">${t("hoy_title", lang)}</h2>
    ${samplesBanner}
    ${await goalCardHtml(lang, picksData.picks, misProductos, today)}
    ${seasonHtml}
    ${nextLiveHtml}
    ${resurgenceHtml}
    ${yaLoTengoSheetHtml(lang)}
    ${
      !hero
        ? `<p class="empty-state">${t("hoy_empty", lang)}</p>`
        : `${heroHtml(hero, hooks, today, lang, statuses[hero.product_id] === "filmed", ownedIds, monthlyGoalRemaining, bestTimes.live?.[hero.category] ?? null, lang === "es" ? hero.category_label_es : hero.category_label_en)}
           ${
             rest.length > 0
               ? `<h3 class="hoy-also-good-title">${t("hoy_also_good_title", lang)}</h3>
                  <div class="card-grid hoy-also-good-list">${rest.map((p) => alsoGoodCardHtml(p, hooks, today, lang, statuses[p.product_id] === "filmed", ownedIds, monthlyGoalRemaining)).join("")}</div>`
               : ""
           }
           <a class="more-link" href="#/week">${t("ver_20_de_la_semana", lang, { n: picksData.picks.length })}</a>`
    }
  `;

  wireGoalCard(container, lang, () => void renderHoy(container, lang));
  wireCategoryHidePrompt(container, () => void renderHoy(container, lang));

  const yaLoTengoProducts = new Map<string, YaLoTengoProduct>(
    [...picksData.picks, ...candidatePool].map((p) => [
      p.product_id,
      {
        product_id: p.product_id,
        name: p.clean_title,
        photo_url: p.image_url || null,
        category: p.category,
        commission_pct: p.commission_rate,
        tiktok_shop_url: p.tiktok_shop_url,
        price: p.price,
        earnings_per_sale: p.earnings_per_sale,
        effort_minutes: p.effort_minutes,
        shop_name: p.shop_name,
      },
    ]),
  );
  wireYaLoTengo(container, lang, yaLoTengoProducts, () => void renderHoy(container, lang));

  container.querySelectorAll<HTMLButtonElement>('[data-action="not-for-me"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { productId, category } = btn.dataset;
      if (!productId || !category) return;
      await setFeedback(productId, "not_for_me");
      showUndoToast(lang, t("undo_toast_not_for_me", lang), () => {
        void clearFeedback(productId).then(() => void renderHoy(container, lang));
      });
      const updatedFeedback = await getAllFeedback();
      if (!getHiddenCategories().includes(category) && countHiddenInCategory(updatedFeedback, categoryByProductId, category) >= 3) {
        const label = lang === "es" ? picksData.picks.find((p) => p.category === category)?.category_label_es : picksData.picks.find((p) => p.category === category)?.category_label_en;
        container.insertAdjacentHTML("beforeend", categoryHidePromptHtml(category, resolveCategoryLabel(category, lang, label), lang));
        wireCategoryHidePrompt(container, () => void renderHoy(container, lang));
      } else {
        void renderHoy(container, lang);
      }
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-action="mark-filmed"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const productId = btn.dataset.productId!;
      btn.classList.add("active");
      btn.textContent = t("marked_filmed_label", lang);
      btn.disabled = true;
      void setStatus(productId, "filmed");
    });
  });
  container.querySelectorAll<HTMLButtonElement>('[data-action="request-sample"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const { productId, price, name } = btn.dataset;
      if (!productId) return;
      const product = yaLoTengoProducts.get(productId);
      if (product?.shop_name) {
        const count = shopRejectionCount(misProductos, product.shop_name);
        if (count > 0) {
          const msg = t(count === 1 ? "solicitudes_shop_rejected_before_one" : "solicitudes_shop_rejected_before_many", lang, { n: count });
          if (!window.confirm(msg)) return;
        }
      }
      requestSample(productId, name ?? "", Number(price) || 0, today);
      if (product) void addMisProducto(solicitudFromProduct(product));
      btn.textContent = t("sample_requested_label", lang);
      btn.classList.add("active");
      btn.disabled = true;
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".copy-hashtags-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const text = btn.dataset.hashtags ?? "";
      const originalLabel = btn.textContent;
      navigator.clipboard
        .writeText(text)
        .then(() => {
          btn.textContent = t("copied_label", lang);
          setTimeout(() => {
            btn.textContent = originalLabel;
          }, 1500);
        })
        .catch(() => {
          // clipboard unavailable -- chips are still readable on their own
        });
    });
  });
}
