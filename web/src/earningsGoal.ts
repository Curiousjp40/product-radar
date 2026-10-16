import type { EarningsEntry, GoalHistoryMonth, MilestoneId } from "./earningsGoalLogic";
import { earningsThisMonth, monthKey, suggestNextGoal } from "./earningsGoalLogic";
import { pullSynced, readLocal, writeSynced } from "./syncedStorage";

/** Part C1/C9: monthly earnings goal, logged sales, milestone badges,
 * weekly video mini-goal and goal history -- synced via syncedStorage's
 * "earnings_goal" key (phone and computer match), localStorage as the
 * offline cache. */

interface GoalState {
  monthlyGoal?: number;
  goalForMonth?: string; // yyyy-mm the current monthlyGoal was set for, so a month rollover is detectable
  entries?: EarningsEntry[];
  weeklyVideoGoal?: number;
  badges?: MilestoneId[];
  goalHistory?: GoalHistoryMonth[];
}

const KEY = "earnings_goal";

function fallback(): GoalState {
  return {};
}

async function loadState(): Promise<GoalState> {
  return pullSynced<GoalState>(KEY, readLocal(KEY, fallback()));
}

function loadStateLocal(): GoalState {
  return readLocal<GoalState>(KEY, fallback());
}

function saveState(state: GoalState): void {
  writeSynced(KEY, state);
}

/** Call once per Hoy render (cheap, pure): if the real current month
 * differs from the month the stored goal was set for, archives last
 * month's {goal, result} into goalHistory and clears monthlyGoal so she's
 * prompted to confirm a new one (pre-filled via suggestNextGoal). Quiet,
 * no shaming -- a month with no goal set just archives nothing. */
export async function rolloverIfNewMonth(today: Date): Promise<void> {
  const state = await loadState();
  const currentKey = monthKey(today);
  if (!state.goalForMonth || state.goalForMonth === currentKey) return;
  const history = [...(state.goalHistory ?? [])];
  if (state.monthlyGoal) {
    const result = earningsThisMonth(state.entries ?? [], parseMonthKeyAsDate(state.goalForMonth));
    if (!history.some((h) => h.month === state.goalForMonth)) {
      history.push({ month: state.goalForMonth, goal: state.monthlyGoal, result });
    }
  }
  saveState({ ...state, monthlyGoal: undefined, goalForMonth: currentKey, goalHistory: history });
}

function parseMonthKeyAsDate(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 15); // mid-month, safe for earningsThisMonth's y/m filter
}

export function suggestedNextGoalFromHistory(history: GoalHistoryMonth[]): number | null {
  if (history.length === 0) return null;
  return suggestNextGoal(history[history.length - 1].result);
}

export async function getMonthlyGoal(): Promise<number | null> {
  return (await loadState()).monthlyGoal ?? null;
}

export function getMonthlyGoalLocal(): number | null {
  return loadStateLocal().monthlyGoal ?? null;
}

export async function setMonthlyGoal(amount: number, today: Date): Promise<void> {
  const state = await loadState();
  saveState({ ...state, monthlyGoal: amount, goalForMonth: monthKey(today) });
}

export async function getEntries(): Promise<EarningsEntry[]> {
  return (await loadState()).entries ?? [];
}

export function getEntriesLocal(): EarningsEntry[] {
  return loadStateLocal().entries ?? [];
}

export async function addEntry(
  amount: number,
  date: string,
  extra: Partial<Pick<EarningsEntry, "productId" | "units" | "paid">> = {},
): Promise<EarningsEntry> {
  const state = await loadState();
  const entry: EarningsEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date,
    amount,
    paid: false,
    ...extra,
  };
  saveState({ ...state, entries: [...(state.entries ?? []), entry] });
  return entry;
}

export async function deleteEntry(id: string): Promise<void> {
  const state = await loadState();
  saveState({ ...state, entries: (state.entries ?? []).filter((e) => e.id !== id) });
}

export async function setEntryPaid(id: string, paid: boolean): Promise<void> {
  const state = await loadState();
  saveState({ ...state, entries: (state.entries ?? []).map((e) => (e.id === id ? { ...e, paid } : e)) });
}

export async function getWeeklyVideoGoal(): Promise<number | null> {
  return (await loadState()).weeklyVideoGoal ?? null;
}

export async function setWeeklyVideoGoal(n: number): Promise<void> {
  const state = await loadState();
  saveState({ ...state, weeklyVideoGoal: n });
}

export async function getBadges(): Promise<MilestoneId[]> {
  return (await loadState()).badges ?? [];
}

export async function addBadges(ids: MilestoneId[]): Promise<void> {
  if (ids.length === 0) return;
  const state = await loadState();
  const existing = new Set(state.badges ?? []);
  ids.forEach((id) => existing.add(id));
  saveState({ ...state, badges: [...existing] });
}

export async function getGoalHistory(): Promise<GoalHistoryMonth[]> {
  return (await loadState()).goalHistory ?? [];
}
