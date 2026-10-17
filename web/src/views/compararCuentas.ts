import { t, type Lang } from "../i18n";
import { getSavedSearch } from "../savedSearches";
import { getSavedProfiles, type SavedProfile } from "../savedProfiles";
import type { AccountSearchResult } from "../types";

const MIN_SELECT = 2;
const MAX_SELECT = 4;

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function topCategoryNames(data: AccountSearchResult, limit = 3): string {
  return data.creator.trend_categories.slice(0, limit).map((c) => c.name).join(", ") || "—";
}

function topLocationName(data: AccountSearchResult): string {
  const countries = data.creator.country_distribution ?? [];
  return countries.length > 0 ? countries[0].name : "—";
}

function topGenderName(data: AccountSearchResult): string {
  const genders = data.creator.gender_distribution ?? [];
  if (genders.length === 0) return "—";
  const top = [...genders].sort((a, b) => b.percentage - a.percentage)[0];
  return `${top.gender} ${top.percentage.toFixed(0)}%`;
}

function postingFrequency(data: AccountSearchResult): string {
  return (data.creator.day28_video_count / 28).toFixed(1);
}

interface Row {
  labelKey: string;
  value: (d: AccountSearchResult) => string;
}

const ROWS: Row[] = [
  { labelKey: "followers_label", value: (d) => formatCount(d.creator.follower_count) },
  { labelKey: "sales_28d_label", value: (d) => `$${d.creator.day28_gmv.toFixed(0)}` },
  { labelKey: "units_label", value: (d) => String(d.creator.day28_units_sold) },
  { labelKey: "videos_posted_label", value: (d) => String(d.creator.day28_video_count) },
  { labelKey: "compare_posting_frequency_label", value: postingFrequency },
  { labelKey: "avg_views_label", value: (d) => formatCount(d.creator.video_avg_play_count) },
  { labelKey: "top_categories_label", value: (d) => topCategoryNames(d) },
  { labelKey: "location_label", value: topLocationName },
  { labelKey: "compare_top_gender_label", value: topGenderName },
];

function buildSummary(entries: { handle: string; data: AccountSearchResult }[], lang: Lang): string {
  if (entries.length < 2) return "";
  const byGmv = [...entries].sort((a, b) => b.data.creator.day28_gmv - a.data.creator.day28_gmv);
  const byFollowers = [...entries].sort((a, b) => b.data.creator.follower_count - a.data.creator.follower_count);
  const byFrequency = [...entries].sort((a, b) => b.data.creator.day28_video_count - a.data.creator.day28_video_count);
  const winner = byGmv[0];
  const runnerUp = byGmv[byGmv.length - 1];
  const gmvGap = winner.data.creator.day28_gmv - runnerUp.data.creator.day28_gmv;

  if (lang === "es") {
    return (
      `@${winner.handle} vende más en los últimos 28 días ($${winner.data.creator.day28_gmv.toFixed(0)}), ` +
      `$${gmvGap.toFixed(0)} más que @${runnerUp.handle}. ` +
      `@${byFollowers[0].handle} tiene más seguidores (${formatCount(byFollowers[0].data.creator.follower_count)}). ` +
      `@${byFrequency[0].handle} publica con más frecuencia (${postingFrequency(byFrequency[0].data)} videos/día). ` +
      `No tenemos datos de lives ni de hashtags por cuenta todavía -- esta comparación es solo de videos.`
    );
  }
  return (
    `@${winner.handle} sold the most over the last 28 days ($${winner.data.creator.day28_gmv.toFixed(0)}), ` +
    `$${gmvGap.toFixed(0)} more than @${runnerUp.handle}. ` +
    `@${byFollowers[0].handle} has the most followers (${formatCount(byFollowers[0].data.creator.follower_count)}). ` +
    `@${byFrequency[0].handle} posts most often (${postingFrequency(byFrequency[0].data)} videos/day). ` +
    `We don't have per-account live or hashtag data yet -- this comparison is video-only.`
  );
}

export async function renderCompararCuentas(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const summaries: SavedProfile[] = await getSavedProfiles();
  const selected = new Set<string>();
  const cache = new Map<string, AccountSearchResult>();

  const draw = async () => {
    const entries: { handle: string; data: AccountSearchResult }[] = [];
    for (const handle of selected) {
      const data = cache.get(handle);
      if (data) entries.push({ handle, data });
    }

    container.innerHTML = `
      <h2 class="view-title">${t("compare_accounts_title", lang)}</h2>
      <p class="best-times-intro">${t("compare_accounts_intro", lang)}</p>
      ${
        summaries.length === 0
          ? `<p class="empty-state">${t("compare_no_saved_searches", lang)}</p>`
          : `<div class="compare-picker-grid">${summaries
              .map(
                (s: SavedProfile) => `
              <button type="button" class="compare-picker-card ${selected.has(s.handle) ? "selected" : ""}" data-handle="${s.handle}">
                <span>@${s.handle}</span>
              </button>`,
              )
              .join("")}</div>`
      }
      ${
        entries.length >= MIN_SELECT
          ? `
        <div class="compare-table-wrap">
          <table class="compare-table">
            <thead><tr><th></th>${entries.map((e) => `<th>@${e.handle}</th>`).join("")}</tr></thead>
            <tbody>
              ${ROWS.map(
                (row) => `
                <tr><td>${t(row.labelKey, lang)}</td>${entries.map((e) => `<td>${row.value(e.data)}</td>`).join("")}</tr>`,
              ).join("")}
            </tbody>
          </table>
        </div>
        <div class="compare-summary">${buildSummary(entries, lang)}</div>
      `
          : selected.size > 0
            ? `<p class="empty-state">${t("compare_select_at_least_two", lang)}</p>`
            : ""
      }
    `;

    container.querySelectorAll<HTMLButtonElement>(".compare-picker-card").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const handle = btn.dataset.handle!;
        if (selected.has(handle)) {
          selected.delete(handle);
        } else {
          if (selected.size >= MAX_SELECT) return;
          selected.add(handle);
          if (!cache.has(handle)) {
            const data = await getSavedSearch(handle);
            if (data) cache.set(handle, data);
          }
        }
        void draw();
      });
    });
  };

  void draw();
}
