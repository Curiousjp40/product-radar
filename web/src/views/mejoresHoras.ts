import { loadBestTimes, loadCandidates } from "../api";
import { categoryLabel as resolveCategoryLabel } from "../categoryLabels";
import { t, type Lang } from "../i18n";
import type { CategoryGroupBestTime } from "../types";
import { videoSubTabsHtml } from "../videoSubTabs";
import { answerCardHtml } from "./answerCard";

// Design review 3.4 ("needs a major renovation"): one group/category at a
// time via a dropdown (fits one phone screen), led by an AnswerCard
// sentence instead of a long list of identical rows. No bar charts here
// yet -- unlike En vivo -> Horarios, best_times.json only stores the
// single best window per category/group (no per-day/per-hour grid), so
// there's no real per-slot data to chart without an engine export change;
// showing fabricated bars would violate "lead with the answer, charts
// support it" by inventing the support. Live best times link to En vivo
// -> Horarios instead of duplicating that page's content here.
let selectedKey = "__all__";

export async function renderMejoresHoras(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const [{ data: bestTimes }, { data: candidatesData }] = await Promise.all([loadBestTimes(), loadCandidates()]);

  const categoryLabel = (cat: string): string => {
    const sample = candidatesData.candidates.find((c) => c.category === cat);
    return resolveCategoryLabel(cat, lang, sample ? (lang === "es" ? sample.category_label_es : sample.category_label_en) : null);
  };
  const groupLabel = (group: string): string => t(group === "home" ? "group_home" : "group_fashion", lang);

  const categoryEntries = Object.entries(bestTimes.categories).sort(([a], [b]) => categoryLabel(a).localeCompare(categoryLabel(b)));
  const groupEntries = Object.entries(bestTimes.groups);

  const options: { key: string; label: string; bt: CategoryGroupBestTime | null }[] = [
    { key: "__all__", label: t("all_categories", lang), bt: null },
    ...groupEntries.map(([g, bt]) => ({ key: `group:${g}`, label: groupLabel(g), bt })),
    ...categoryEntries.map(([c, bt]) => ({ key: `cat:${c}`, label: categoryLabel(c), bt })),
  ];
  if (!options.some((o) => o.key === selectedKey)) selectedKey = "__all__";
  const selected = options.find((o) => o.key === selectedKey)!;

  const cardsHtml =
    selectedKey === "__all__"
      ? [...groupEntries.map(([g, bt]) => ({ label: groupLabel(g), bt })), ...categoryEntries.map(([c, bt]) => ({ label: categoryLabel(c), bt }))]
          .map((o) => `<div class="answer-card-labeled"><p class="answer-card-eyebrow">${o.label}</p>${answerCardHtml(o.bt, o.label, lang, "video")}</div>`)
          .join("")
      : answerCardHtml(selected.bt, selected.label, lang, "video");

  container.innerHTML = `
    ${videoSubTabsHtml("mejores-horas", lang)}
    <h2 class="view-title">${t("mejores_horas_title", lang)}</h2>
    <p class="best-times-intro">${t("mejores_horas_intro", lang)}</p>

    <select class="mejores-horas-select">
      ${options.map((o) => `<option value="${o.key}" ${o.key === selectedKey ? "selected" : ""}>${o.label}</option>`).join("")}
    </select>

    ${cardsHtml}

    <p class="best-times-footnote">
      ${t("mejores_horas_live_times_link_note", lang)}
      <a href="#/en-vivo">${t("en_vivo_tab_horarios", lang)}</a>
    </p>
    <p class="best-times-footnote">
      ${t("mejores_horas_footnote", lang)}
      <a href="https://www.tiktok.com/analytics" target="_blank" rel="noopener">${t("mejores_horas_tiktok_studio_link", lang)}</a>
    </p>
  `;

  container.querySelector<HTMLSelectElement>(".mejores-horas-select")?.addEventListener("change", (e) => {
    selectedKey = (e.currentTarget as HTMLSelectElement).value;
    void renderMejoresHoras(container, lang);
  });
}
