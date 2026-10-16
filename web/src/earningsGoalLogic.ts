// H1 (monthly earnings goal) + Part C9 (2026-10-16 upgrade: pace,
// milestones, streaks, goal history). Pure functions, no imports -- state
// lives in earningsGoal.ts (synced via syncedStorage.ts).

export interface EarningsEntry {
  id: string;
  date: string; // ISO yyyy-mm-dd
  amount: number;
  productId?: string | null;
  units?: number | null;
  paid?: boolean; // Mi Dinero's pending-vs-paid toggle; undefined treated as unpaid
}

export interface GoalProgress {
  goal: number;
  earned: number;
  remaining: number;
  pct: number; // 0-100, capped
}

// "yyyy-mm-dd" parsed as a LOCAL date, not `new Date("yyyy-mm-dd")`'s UTC
// midnight -- the latter shifts a day backward in any negative-UTC-offset
// timezone (US included) once compared against local date boundaries,
// which silently dropped Mondays/pushed Sundays out of week ranges and
// broke day-boundary streak comparisons.
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function earningsThisMonth(entries: EarningsEntry[], today: Date): number {
  const y = today.getFullYear();
  const m = today.getMonth();
  return entries
    .filter((e) => {
      const d = parseLocalDate(e.date);
      return d.getFullYear() === y && d.getMonth() === m;
    })
    .reduce((sum, e) => sum + e.amount, 0);
}

export function earningsProgress(goal: number | null, earnedThisMonth: number): GoalProgress | null {
  if (goal === null || goal <= 0) return null;
  const earned = Math.max(earnedThisMonth, 0);
  const remaining = Math.max(goal - earned, 0);
  const pct = Math.min(Math.round((earned / goal) * 100), 100);
  return { goal, earned, remaining, pct };
}

// 1 sale per video is a known simplification -- there's no per-category
// "videos needed" history saved anywhere, so this estimates from this
// week's own picks instead of inventing a number.
export function videosNeeded(remaining: number, earningsPerVideo: number): number {
  if (earningsPerVideo <= 0 || remaining <= 0) return 0;
  return Math.ceil(remaining / earningsPerVideo);
}

export interface CategoryEarner {
  category: string;
  category_label_es: string;
  category_label_en: string;
  earnings_per_sale: number;
}

// Points her at whichever of this week's picks earns the most per sale, so
// closing the gap is framed around her best real opportunity this week.
export function bestCategoryForGoal<T extends CategoryEarner>(picks: T[]): T | null {
  if (picks.length === 0) return null;
  return picks.reduce((best, p) => (p.earnings_per_sale > best.earnings_per_sale ? p : best));
}

// --- Part C9 additions (2026-10-16) ---------------------------------------

export interface GoalPace {
  dailyAverage: number;
  projectedTotal: number;
  daysElapsed: number;
  daysLeft: number;
  daysInMonth: number;
  onPace: boolean; // projectedTotal >= goal
}

/** "Vas al ritmo de $X este mes": projects the full month's total from the
 * daily average earned so far. daysElapsed counts today, so a fresh month
 * (day 1, $0 earned) doesn't divide by zero. */
export function monthlyPace(goal: number, earnedThisMonth: number, today: Date): GoalPace {
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysElapsed = today.getDate();
  const daysLeft = Math.max(daysInMonth - daysElapsed, 0);
  const dailyAverage = earnedThisMonth / daysElapsed;
  const projectedTotal = dailyAverage * daysInMonth;
  return { dailyAverage, projectedTotal, daysElapsed, daysLeft, daysInMonth, onPace: projectedTotal >= goal };
}

export interface SalesNeededFor {
  label: string;
  earningsPerSale: number;
  salesNeeded: number;
}

/** "Lo que te falta": for each of up to 3 candidate items, how many more
 * sales of IT ALONE would close the remaining gap. */
export function salesNeededForItems<T extends { label: string; earningsPerSale: number }>(
  remaining: number,
  items: T[],
  limit = 3,
): SalesNeededFor[] {
  if (remaining <= 0) return [];
  return [...items]
    .sort((a, b) => b.earningsPerSale - a.earningsPerSale)
    .slice(0, limit)
    .filter((i) => i.earningsPerSale > 0)
    .map((i) => ({ label: i.label, earningsPerSale: i.earningsPerSale, salesNeeded: Math.ceil(remaining / i.earningsPerSale) }));
}

/** "Esta semana: X videos" -- counts items whose date_posted falls in the
 * current ISO week (Monday-Sunday, matching the rest of the site's
 * weekday numbering). */
export function weekRange(today: Date): { start: Date; end: Date } {
  const day = today.getDay(); // 0=Sun..6=Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + mondayOffset);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return { start, end };
}

export function videosPostedThisWeek(datesPosted: (string | null | undefined)[], today: Date): number {
  const { start, end } = weekRange(today);
  return datesPosted.filter((d) => {
    if (!d) return false;
    const date = parseLocalDate(d);
    return date >= start && date <= end;
  }).length;
}

// --- Streaks ---------------------------------------------------------------

/** Consecutive CALENDAR DAYS, ending today or yesterday (a day not yet
 * over still counts the streak as alive), with at least one post. Dates
 * are deduped to one entry per calendar day before counting. */
export function dayStreak(datesPosted: (string | null | undefined)[], today: Date): number {
  const days = new Set(datesPosted.filter((d): d is string => !!d).map((d) => parseLocalDate(d).toDateString()));
  if (days.size === 0) return 0;
  let streak = 0;
  const cursor = new Date(today);
  // today with nothing posted yet doesn't break an existing streak --
  // start checking from today, but allow one miss (today) before counting.
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  while (days.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Consecutive ISO weeks (Monday-start), same "today doesn't break it yet"
 * tolerance as dayStreak. */
export function weekStreak(datesPosted: (string | null | undefined)[], today: Date): number {
  const weekKey = (d: Date): string => {
    const { start } = weekRange(d);
    return start.toDateString();
  };
  const weeks = new Set(datesPosted.filter((d): d is string => !!d).map((d) => weekKey(parseLocalDate(d))));
  if (weeks.size === 0) return 0;
  let streak = 0;
  let cursor = new Date(today);
  if (!weeks.has(weekKey(cursor))) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 7);
  }
  while (weeks.has(weekKey(cursor))) {
    streak++;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 7);
  }
  return streak;
}

// --- Milestones --------------------------------------------------------------

export type MilestoneId =
  | "monthly_25"
  | "monthly_50"
  | "monthly_75"
  | "monthly_100"
  | "first_sale_of_month"
  | "lifetime_100"
  | "lifetime_500"
  | "lifetime_1000"
  | "lifetime_5000";

const LIFETIME_THRESHOLDS: [MilestoneId, number][] = [
  ["lifetime_100", 100],
  ["lifetime_500", 500],
  ["lifetime_1000", 1000],
  ["lifetime_5000", 5000],
];

const MONTHLY_PCT_THRESHOLDS: [MilestoneId, number][] = [
  ["monthly_25", 25],
  ["monthly_50", 50],
  ["monthly_75", 75],
  ["monthly_100", 100],
];

/** Given the full badge set already earned (ever) and the current state,
 * returns which NEW milestone ids were just crossed -- call this right
 * after logging a sale, diff against the stored badge list, and only
 * celebrate ids that come back here and weren't already in storage. */
export function newlyCrossedMilestones(
  alreadyEarned: Set<MilestoneId>,
  monthPct: number,
  lifetimeTotal: number,
  monthEntryCountBeforeThisOne: number,
): MilestoneId[] {
  const crossed: MilestoneId[] = [];
  if (monthEntryCountBeforeThisOne === 0 && !alreadyEarned.has("first_sale_of_month")) {
    crossed.push("first_sale_of_month");
  }
  for (const [id, pct] of MONTHLY_PCT_THRESHOLDS) {
    if (monthPct >= pct && !alreadyEarned.has(id)) crossed.push(id);
  }
  for (const [id, amount] of LIFETIME_THRESHOLDS) {
    if (lifetimeTotal >= amount && !alreadyEarned.has(id)) crossed.push(id);
  }
  return crossed;
}

// --- Goal history ------------------------------------------------------------

export interface GoalHistoryMonth {
  month: string; // yyyy-mm
  goal: number;
  result: number;
}

/** Next month's suggested goal = this month's actual result + 10-20%
 * (midpoint 15%), rounded to the nearest 10. */
export function suggestNextGoal(lastMonthResult: number): number {
  if (lastMonthResult <= 0) return 0;
  return Math.round((lastMonthResult * 1.15) / 10) * 10;
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
