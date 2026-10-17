import { getEntries, getGoalHistory, setEntryPaid } from "../earningsGoal";
import { monthKey } from "../earningsGoalLogic";
import { t, type Lang } from "../i18n";
import { approvalRate, getAllMisProductos, type MisProducto } from "../misProductos";
import type { EarningsEntry } from "../earningsGoalLogic";

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function lastNMonths(today: Date, n: number): { key: string; label: Date }[] {
  const out: { key: string; label: Date }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push({ key: monthKey(d), label: d });
  }
  return out;
}

function monthLabel(d: Date, lang: Lang): string {
  return d.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { month: "short", year: "2-digit" });
}

function monthlyBarChartHtml(entries: EarningsEntry[], today: Date, lang: Lang): string {
  const months = lastNMonths(today, 6);
  const totals = months.map(({ key }) =>
    entries.filter((e) => monthKey(new Date(e.date)) === key).reduce((s, e) => s + e.amount, 0),
  );
  const max = Math.max(...totals, 1);
  return `
    <div class="mi-dinero-chart">
      ${months
        .map(({ label }, i) => {
          const height = Math.max((totals[i] / max) * 100, 2);
          return `
          <div class="mi-dinero-bar-col">
            <div class="mi-dinero-bar-track"><div class="mi-dinero-bar-fill" style="height:${height}%"></div></div>
            <div class="mi-dinero-bar-value">${formatMoney(totals[i])}</div>
            <div class="mi-dinero-bar-label">${monthLabel(label, lang)}</div>
          </div>`;
        })
        .join("")}
    </div>
  `;
}

function topNByKey(entries: EarningsEntry[], misProductos: MisProducto[], keyFn: (item: MisProducto) => string | null, limit: number): { label: string; amount: number }[] {
  const byItemId = new Map(misProductos.map((i) => [i.id, i]));
  const totals = new Map<string, number>();
  for (const e of entries) {
    if (!e.productId) continue;
    const item = byItemId.get(e.productId);
    if (!item) continue;
    const key = keyFn(item);
    if (!key) continue;
    totals.set(key, (totals.get(key) ?? 0) + e.amount);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, amount]) => ({ label, amount }));
}

function entryRowHtml(entry: EarningsEntry, misProductos: MisProducto[], lang: Lang): string {
  const item = entry.productId ? misProductos.find((i) => i.id === entry.productId) : undefined;
  return `
    <div class="mi-dinero-entry-row">
      <div class="mi-dinero-entry-info">
        <div class="name">${item?.name ?? t("quick_venta_generic_option", lang)}</div>
        <div class="meta">${entry.date} &middot; ${formatMoney(entry.amount)}${entry.units ? ` &middot; ${entry.units}u` : ""}</div>
      </div>
      <label class="mi-dinero-paid-toggle">
        <input type="checkbox" data-action="toggle-paid" data-id="${entry.id}" ${entry.paid ? "checked" : ""} />
        ${t("pagado_label", lang)}
      </label>
    </div>
  `;
}

export async function renderMiDinero(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const [entries, misProductos, goalHistory] = await Promise.all([getEntries(), getAllMisProductos(), getGoalHistory()]);
  const today = new Date();

  const draw = () => {
    // Design review item 0.10: with no sales yet, one friendly onboarding
    // card instead of 7 empty cards + a chart of $0.00 bars.
    if (entries.length === 0) {
      container.innerHTML = `
        <h2 class="view-title">${t("mi_dinero_title", lang)}</h2>
        <div class="insight-card mi-dinero-empty-card">
          <p class="empty-state">${t("mi_dinero_empty_title", lang)}</p>
          <a class="btn-primary" href="#/hoy">${t("mi_dinero_empty_cta", lang)}</a>
        </div>
      `;
      return;
    }

    const months = lastNMonths(today, 6);
    const thisMonthKey = months[months.length - 1].key;
    const lastMonthKey = months[months.length - 2]?.key;
    const thisMonthTotal = entries.filter((e) => monthKey(new Date(e.date)) === thisMonthKey).reduce((s, e) => s + e.amount, 0);
    const lastMonthTotal = lastMonthKey ? entries.filter((e) => monthKey(new Date(e.date)) === lastMonthKey).reduce((s, e) => s + e.amount, 0) : 0;
    const change = pctChange(thisMonthTotal, lastMonthTotal);

    const allMonthTotals = new Map<string, number>();
    for (const e of entries) {
      const k = monthKey(new Date(e.date));
      allMonthTotals.set(k, (allMonthTotals.get(k) ?? 0) + e.amount);
    }
    let bestMonth: { key: string; amount: number } | null = null;
    for (const [key, amount] of allMonthTotals) {
      if (!bestMonth || amount > bestMonth.amount) bestMonth = { key, amount };
    }

    const byCategory = topNByKey(entries, misProductos, (i) => i.category, 5);
    const byProduct = topNByKey(entries, misProductos, (i) => i.name, 5);

    const postedItems = misProductos.filter((i) => i.date_posted && i.effort_minutes);
    const totalEffortMinutes = postedItems.reduce((s, i) => s + (i.effort_minutes ?? 0), 0);
    const postedEarnings = entries
      .filter((e) => e.productId && postedItems.some((i) => i.id === e.productId))
      .reduce((s, e) => s + e.amount, 0);
    const perHour = totalEffortMinutes > 0 ? (postedEarnings / totalEffortMinutes) * 60 : null;
    const rate = approvalRate(misProductos);

    const receivedThisMonth = misProductos.filter((i) => i.date_received && monthKey(new Date(i.date_received)) === thisMonthKey);
    const receivedAllTime = misProductos.filter((i) => i.date_received);
    const freeValueThisMonth = receivedThisMonth.reduce((s, i) => s + (i.price ?? 0), 0);
    const freeValueAllTime = receivedAllTime.reduce((s, i) => s + (i.price ?? 0), 0);

    const recentEntries = [...entries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
    const pendingTotal = entries.filter((e) => !e.paid).reduce((s, e) => s + e.amount, 0);

    container.innerHTML = `
      <h2 class="view-title">${t("mi_dinero_title", lang)}</h2>

      <div class="insight-card">
        <h3>${t("mi_dinero_monthly_chart_title", lang)}</h3>
        ${monthlyBarChartHtml(entries, today, lang)}
        <p class="goal-progress-text">
          ${t("mi_dinero_this_vs_last", lang, { amount: formatMoney(thisMonthTotal) })}
          ${change !== null ? ` (${change >= 0 ? "+" : ""}${change.toFixed(0)}% ${t("mi_dinero_vs_last_month", lang)})` : ""}
        </p>
        ${bestMonth ? `<p class="goal-progress-text">${t("mi_dinero_best_month", lang, { month: bestMonth.key, amount: formatMoney(bestMonth.amount) })}</p>` : ""}
      </div>

      <div class="insight-card">
        <h3>${t("mi_dinero_by_category_title", lang)}</h3>
        ${
          byCategory.length === 0
            ? `<p class="empty-state">${t("mi_dinero_no_data", lang)}</p>`
            : byCategory.map((c) => `<div class="mi-dinero-rank-row"><span>${c.label}</span><span>${formatMoney(c.amount)}</span></div>`).join("")
        }
      </div>

      <div class="insight-card">
        <h3>${t("mi_dinero_by_product_title", lang)}</h3>
        ${
          byProduct.length === 0
            ? `<p class="empty-state">${t("mi_dinero_no_data", lang)}</p>`
            : byProduct.map((p) => `<div class="mi-dinero-rank-row"><span>${p.label}</span><span>${formatMoney(p.amount)}</span></div>`).join("")
        }
      </div>

      <div class="insight-card">
        <h3>${t("mi_dinero_approval_rate", lang)}</h3>
        <p class="goal-progress-text">${rate !== null ? `${(rate * 100).toFixed(0)}%` : t("mi_dinero_no_data", lang)}</p>
      </div>

      <div class="insight-card">
        <h3>${t("mi_dinero_per_hour_title", lang)}</h3>
        <p class="goal-progress-text">${perHour !== null ? t("mi_dinero_per_hour_value", lang, { amount: formatMoney(perHour) }) : t("mi_dinero_no_data", lang)}</p>
      </div>

      <div class="insight-card">
        <h3>${t("mi_dinero_free_products_title", lang)}</h3>
        <p class="goal-progress-text">${t("mi_dinero_free_products_this_month", lang, { amount: formatMoney(freeValueThisMonth) })}</p>
        <p class="goal-progress-text">${t("mi_dinero_free_products_all_time", lang, { amount: formatMoney(freeValueAllTime) })}</p>
      </div>

      <div class="insight-card">
        <h3>${t("mi_dinero_recent_sales_title", lang)}</h3>
        <p class="goal-progress-text">${t("mi_dinero_pending_total", lang, { amount: formatMoney(pendingTotal) })}</p>
        ${
          recentEntries.length === 0
            ? `<p class="empty-state">${t("mi_dinero_no_data", lang)}</p>`
            : `<div class="mi-dinero-entry-list">${recentEntries.map((e) => entryRowHtml(e, misProductos, lang)).join("")}</div>`
        }
      </div>

      ${
        goalHistory.length > 0
          ? `<div class="insight-card">
              <h3>${t("mi_dinero_goal_history_title", lang)}</h3>
              ${goalHistory
                .slice()
                .reverse()
                .map(
                  (h) => `
                <div class="mi-dinero-rank-row">
                  <span>${h.month}</span>
                  <span>${formatMoney(h.result)} / ${formatMoney(h.goal)} ${h.result >= h.goal ? `&middot; ${t("mi_dinero_meta_cumplida", lang)}` : ""}</span>
                </div>`,
                )
                .join("")}
            </div>`
          : ""
      }
    `;

    container.querySelectorAll<HTMLInputElement>('[data-action="toggle-paid"]').forEach((input) => {
      input.addEventListener("change", async () => {
        const id = input.dataset.id!;
        await setEntryPaid(id, input.checked);
        const entry = entries.find((e) => e.id === id);
        if (entry) entry.paid = input.checked;
        draw();
      });
    });
  };

  draw();
}
