import {
  addBadges,
  addEntry,
  getBadges,
  getEntries,
  getGoalHistory,
  getMonthlyGoal,
  getWeeklyVideoGoal,
  rolloverIfNewMonth,
  setMonthlyGoal,
  setWeeklyVideoGoal,
  suggestedNextGoalFromHistory,
} from "../earningsGoal";
import {
  dayStreak,
  earningsProgress,
  earningsThisMonth,
  monthlyPace,
  newlyCrossedMilestones,
  salesNeededForItems,
  videosPostedThisWeek,
  weekStreak,
  type MilestoneId,
} from "../earningsGoalLogic";
import { t, type Lang } from "../i18n";
import type { MisProducto } from "../misProductos";
import type { Pick } from "../types";

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

const MILESTONE_LABEL_KEYS: Record<MilestoneId, string> = {
  monthly_25: "milestone_monthly_25",
  monthly_50: "milestone_monthly_50",
  monthly_75: "milestone_monthly_75",
  monthly_100: "milestone_monthly_100",
  first_sale_of_month: "milestone_first_sale",
  lifetime_100: "milestone_lifetime_100",
  lifetime_500: "milestone_lifetime_500",
  lifetime_1000: "milestone_lifetime_1000",
  lifetime_5000: "milestone_lifetime_5000",
};

const MILESTONE_ICONS: Record<MilestoneId, string> = {
  monthly_25: "\u{1F331}",
  monthly_50: "\u{1F33F}",
  monthly_75: "\u{1F33A}",
  monthly_100: "\u{1F3C6}",
  first_sale_of_month: "\u{2728}",
  lifetime_100: "\u{1F4B5}",
  lifetime_500: "\u{1F4B0}",
  lifetime_1000: "\u{1F48E}",
  lifetime_5000: "\u{1F451}",
};

function candidateItemsFor(misProductos: MisProducto[], picks: Pick[]): { label: string; earningsPerSale: number }[] {
  const seen = new Set<string>();
  const items: { label: string; earningsPerSale: number }[] = [];
  for (const item of misProductos) {
    if (item.earnings_per_sale && item.earnings_per_sale > 0) {
      items.push({ label: item.name, earningsPerSale: item.earnings_per_sale });
      if (item.product_id) seen.add(item.product_id);
    }
  }
  for (const p of picks) {
    if (seen.has(p.product_id)) continue;
    items.push({ label: p.clean_title, earningsPerSale: p.earnings_per_sale });
  }
  return items;
}

function quickSaleFormHtml(misProductos: MisProducto[], lang: Lang): string {
  const eligible = misProductos.filter((i) => i.status !== "rechazado" && i.status !== "no_llego");
  return `
    <form class="earnings-goal-form quick-venta-form" data-form="quick-venta" style="display:none">
      <select name="item_id">
        <option value="">${t("quick_venta_generic_option", lang)}</option>
        ${eligible.map((i) => `<option value="${i.id}" data-eps="${i.earnings_per_sale ?? ""}">${i.name}</option>`).join("")}
      </select>
      <input type="number" name="units" min="1" step="1" value="1" placeholder="${t("quick_venta_units_label", lang)}" />
      <input type="number" name="amount" min="0" step="0.01" placeholder="${t("quick_venta_amount_label", lang)}" required />
      <input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}" required />
      <button type="submit" class="btn-primary">${t("quick_venta_save_button", lang)}</button>
    </form>
  `;
}

export async function goalCardHtml(lang: Lang, picks: Pick[], misProductos: MisProducto[], today: Date): Promise<string> {
  await rolloverIfNewMonth(today);
  const [goal, entries, weeklyGoal, badges, history] = await Promise.all([
    getMonthlyGoal(),
    getEntries(),
    getWeeklyVideoGoal(),
    getBadges(),
    getGoalHistory(),
  ]);
  const earned = earningsThisMonth(entries, today);
  const progress = earningsProgress(goal, earned);
  const datesPosted = misProductos.map((i) => i.date_posted);
  const videosThisWeek = videosPostedThisWeek(datesPosted, today);
  const dStreak = dayStreak(datesPosted, today);
  const wStreak = weekStreak(datesPosted, today);

  const earnedBadges = badges.filter((b) => b !== "first_sale_of_month" || earned > 0);
  const logrosHtml =
    earnedBadges.length > 0
      ? `<div class="logros-row">${earnedBadges.map((b) => `<span class="logro-badge" title="${t(MILESTONE_LABEL_KEYS[b], lang)}">${MILESTONE_ICONS[b]}</span>`).join("")}</div>`
      : "";

  const streakHtml =
    wStreak > 0
      ? `<p class="goal-streak-text">${t("racha_weeks", lang, { n: wStreak })}</p>`
      : dStreak > 0
        ? `<p class="goal-streak-text">${t("racha_days", lang, { n: dStreak })}</p>`
        : "";

  const weeklyMiniGoalHtml = `
    <div class="weekly-mini-goal">
      ${
        weeklyGoal
          ? `<p class="goal-progress-text">${t("weekly_mini_goal_progress", lang, { done: videosThisWeek, goal: weeklyGoal })}</p>`
          : ""
      }
      <button type="button" class="btn-save-pill" data-action="toggle-weekly-goal">${t("weekly_mini_goal_set_button", lang)}</button>
      <form class="earnings-goal-form" data-form="weekly-goal" style="display:none">
        <input type="number" name="weekly_goal" min="1" step="1" value="${weeklyGoal ?? ""}" placeholder="${t("weekly_mini_goal_placeholder", lang)}" />
        <button type="submit" class="btn-save-pill">${t("earnings_goal_save_button", lang)}</button>
      </form>
    </div>
  `;

  if (!progress) {
    const suggestion = suggestedNextGoalFromHistory(history);
    return `
      <div class="insight-card earnings-goal-card">
        <h3>${t("earnings_goal_title", lang)}</h3>
        <p class="empty-state" style="padding:4px 0">${t("earnings_goal_no_goal", lang)}</p>
        <form class="earnings-goal-form" data-form="set-goal">
          <input type="number" min="0" step="1" name="goal" placeholder="${t("earnings_goal_set_label", lang)}" value="${suggestion ?? ""}" required />
          <button type="submit" class="btn-primary">${t("earnings_goal_save_button", lang)}</button>
        </form>
        ${logrosHtml}
      </div>
    `;
  }

  const pace = monthlyPace(progress.goal, progress.earned, today);
  const candidates = candidateItemsFor(misProductos, picks);
  const salesNeeded = salesNeededForItems(progress.remaining, candidates, 3);

  return `
    <div class="insight-card earnings-goal-card">
      <h3>${t("earnings_goal_title", lang)}</h3>
      <div class="goal-progress-bar"><div class="goal-progress-fill" style="width:${progress.pct}%"></div></div>
      <p class="goal-progress-text">${t("earnings_goal_progress", lang, { earned: formatMoney(progress.earned), goal: formatMoney(progress.goal) })} (${progress.pct}%)</p>
      ${
        progress.remaining > 0
          ? `<p class="goal-progress-text">${t("earnings_goal_remaining", lang, { amount: formatMoney(progress.remaining) })}</p>`
          : `<p class="goal-progress-text">${t("earnings_goal_reached", lang)}</p>`
      }
      <p class="goal-pace-text ${pace.onPace ? "on-pace" : "behind-pace"}">
        ${t("goal_pace_text", lang, { amount: formatMoney(pace.projectedTotal) })}
        &middot; ${t("goal_days_left", lang, { n: pace.daysLeft })}
      </p>
      ${
        salesNeeded.length > 0
          ? `<p class="goal-progress-text">${t("lo_que_te_falta_label", lang)}: ${salesNeeded.map((s) => t("sales_needed_item", lang, { n: s.salesNeeded, label: s.label })).join(" " + t("o_label", lang) + " ")}</p>`
          : ""
      }
      ${streakHtml}
      ${weeklyMiniGoalHtml}
      <div class="earnings-goal-actions">
        <button type="button" class="btn-primary" data-action="toggle-quick-venta">${t("quick_venta_button", lang)}</button>
        <button type="button" class="btn-save-pill" data-action="toggle-edit-goal">${t("edit_goal_button", lang)}</button>
      </div>
      ${quickSaleFormHtml(misProductos, lang)}
      <form class="earnings-goal-form" data-form="set-goal" style="display:none">
        <input type="number" min="0" step="1" name="goal" placeholder="${t("earnings_goal_set_label", lang)}" value="${progress.goal}" required />
        <button type="submit" class="btn-primary">${t("earnings_goal_save_button", lang)}</button>
      </form>
      ${logrosHtml}
      <div class="celebration-slot" aria-live="polite"></div>
    </div>
  `;
}

function celebrationHtml(ids: MilestoneId[], lang: Lang): string {
  return `
    <div class="celebration-overlay">
      ${ids.map((id) => `<div class="celebration-badge"><span class="celebration-icon">${MILESTONE_ICONS[id]}</span><span>${t(MILESTONE_LABEL_KEYS[id], lang)}</span></div>`).join("")}
    </div>
  `;
}

export function wireGoalCard(container: HTMLElement, lang: Lang, rerender: () => void): void {
  const card = container.querySelector<HTMLElement>(".earnings-goal-card");
  if (!card) return;

  card.querySelector('[data-form="set-goal"]')?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = (e.currentTarget as HTMLFormElement).elements.namedItem("goal") as HTMLInputElement;
    const amount = Number(input.value);
    if (amount > 0) {
      void setMonthlyGoal(amount, new Date()).then(rerender);
    }
  });

  card.querySelector('[data-form="weekly-goal"]')?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = (e.currentTarget as HTMLFormElement).elements.namedItem("weekly_goal") as HTMLInputElement;
    const n = Number(input.value);
    if (n > 0) {
      void setWeeklyVideoGoal(n).then(rerender);
    }
  });

  card.querySelector('[data-form="quick-venta"]')?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const itemId = (form.elements.namedItem("item_id") as HTMLSelectElement).value;
    const units = Number((form.elements.namedItem("units") as HTMLInputElement).value) || 1;
    const amount = Number((form.elements.namedItem("amount") as HTMLInputElement).value);
    const date = (form.elements.namedItem("date") as HTMLInputElement).value;
    if (!(amount > 0) || !date) return;

    const [goal, entriesBefore, badgesBefore] = await Promise.all([getMonthlyGoal(), getEntries(), getBadges()]);
    const today = new Date();
    const monthEntryCountBefore = entriesBefore.filter((en) => {
      const d = new Date(en.date);
      return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
    }).length;

    await addEntry(amount, date, { productId: itemId || null, units });

    const entriesAfter = [...entriesBefore, { id: "tmp", date, amount }];
    const earnedAfter = earningsThisMonth(entriesAfter, today);
    const lifetimeTotal = entriesAfter.reduce((s, en) => s + en.amount, 0);
    if (goal) {
      const progress = earningsProgress(goal, earnedAfter);
      const crossed = newlyCrossedMilestones(new Set(badgesBefore), progress?.pct ?? 0, lifetimeTotal, monthEntryCountBefore);
      if (crossed.length > 0) {
        await addBadges(crossed);
        const slot = container.querySelector(".celebration-slot");
        if (slot) {
          slot.innerHTML = celebrationHtml(crossed, lang);
          setTimeout(() => {
            rerender();
          }, 2400);
          return;
        }
      }
    }
    rerender();
  });

  card.querySelector('[data-action="toggle-quick-venta"]')?.addEventListener("click", () => {
    const form = card.querySelector<HTMLElement>('[data-form="quick-venta"]');
    if (form) form.style.display = form.style.display === "none" ? "flex" : "none";
  });
  card.querySelector('[data-action="toggle-edit-goal"]')?.addEventListener("click", () => {
    const form = card.querySelector<HTMLElement>('[data-form="set-goal"]');
    if (form) form.style.display = form.style.display === "none" ? "flex" : "none";
  });
  card.querySelector('[data-action="toggle-weekly-goal"]')?.addEventListener("click", () => {
    const form = card.querySelector<HTMLElement>('[data-form="weekly-goal"]');
    if (form) form.style.display = form.style.display === "none" ? "flex" : "none";
  });

  const itemSelect = card.querySelector<HTMLSelectElement>('[name="item_id"]');
  itemSelect?.addEventListener("change", () => {
    const selected = itemSelect.selectedOptions[0];
    const amountInput = card.querySelector<HTMLInputElement>('[name="amount"]');
    const unitsInput = card.querySelector<HTMLInputElement>('[name="units"]');
    const eps = Number(selected?.dataset.eps);
    if (amountInput && eps > 0) {
      const units = Number(unitsInput?.value) || 1;
      amountInput.value = (eps * units).toFixed(2);
    }
  });
  const unitsInput = card.querySelector<HTMLInputElement>('[name="units"]');
  unitsInput?.addEventListener("input", () => {
    const selected = itemSelect?.selectedOptions[0];
    const amountInput = card.querySelector<HTMLInputElement>('[name="amount"]');
    const eps = Number(selected?.dataset.eps);
    if (amountInput && eps > 0) {
      amountInput.value = (eps * (Number(unitsInput.value) || 1)).toFixed(2);
    }
  });
}
