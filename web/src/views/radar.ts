import { loadCandidates } from "../api";
import { t, type Lang } from "../i18n";
import type { Candidate } from "../types";

function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const w = 80;
  const h = 24;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = w / (values.length - 1 || 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${points}" fill="none" stroke="var(--accent-2)" stroke-width="2"/></svg>`;
}

type SortKey = "score" | "ev_typical" | "price" | "commission_rate";

function sortCandidates(candidates: Candidate[], key: SortKey): Candidate[] {
  // A suspicious candidate has null score/ev_typical (never scored) --
  // sorted last regardless of sort key rather than breaking the comparator.
  return [...candidates].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  });
}

function formatNullable(value: number | null, fmt: (v: number) => string): string {
  return value === null ? "—" : fmt(value);
}

export async function renderRadar(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const { data, isSample } = await loadCandidates();
  const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";

  let sortKey: SortKey = "score";
  let categoryFilter = "";

  const draw = () => {
    const categories = Array.from(new Set(data.candidates.map((c) => c.category))).sort();
    const filtered = categoryFilter ? data.candidates.filter((c) => c.category === categoryFilter) : data.candidates;
    const sorted = sortCandidates(filtered, sortKey);

    container.innerHTML = `
      ${banner}
      <h2 class="view-title">${t("radar_title", lang)}</h2>
      <div class="stat-row">
        <select id="category-filter" class="status-select">
          <option value="">${t("category", lang)}: *</option>
          ${categories.map((c) => `<option value="${c}" ${c === categoryFilter ? "selected" : ""}>${c}</option>`).join("")}
        </select>
        <select id="sort-key" class="status-select">
          <option value="score" ${sortKey === "score" ? "selected" : ""}>${t("score", lang)}</option>
          <option value="ev_typical" ${sortKey === "ev_typical" ? "selected" : ""}>${t("ev_typical", lang)}</option>
          <option value="price" ${sortKey === "price" ? "selected" : ""}>${t("price", lang)}</option>
          <option value="commission_rate" ${sortKey === "commission_rate" ? "selected" : ""}>${t("commission", lang)}</option>
        </select>
      </div>
      <div class="table-scroll">
        <table class="radar-table">
          <thead>
            <tr>
              <th></th>
              <th>${t("product_col", lang)}</th>
              <th>${t("category", lang)}</th>
              <th>${t("stage", lang)}</th>
              <th>${t("price", lang)}</th>
              <th>${t("commission", lang)}</th>
              <th>${t("score", lang)}</th>
              <th>${t("ev_typical", lang)}</th>
            </tr>
          </thead>
          <tbody>
            ${sorted
              .map(
                (c) => `
              <tr${c.suspicious ? ' style="opacity:0.5"' : ""}>
                <td>${sparkline(c.daily_units)}</td>
                <td>${c.title}<br/><small style="color:var(--text-dim)">${c.shop_name}</small></td>
                <td>${c.category}</td>
                <td>${c.stage ? t(`stage_${c.stage}`, lang) : t("suspicious_label", lang)}</td>
                <td>$${c.price.toFixed(2)}</td>
                <td>${(c.commission_rate * 100).toFixed(0)}%</td>
                <td>${formatNullable(c.score, (v) => String(v))}</td>
                <td>${formatNullable(c.ev_typical, (v) => `$${v.toFixed(0)}`)}</td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;

    container.querySelector<HTMLSelectElement>("#category-filter")?.addEventListener("change", (e) => {
      categoryFilter = (e.target as HTMLSelectElement).value;
      draw();
    });
    container.querySelector<HTMLSelectElement>("#sort-key")?.addEventListener("change", (e) => {
      sortKey = (e.target as HTMLSelectElement).value as SortKey;
      draw();
    });
  };

  draw();
}
