import type { EarningsEntry } from "./earningsGoalLogic";

/** Monthly earnings goal + logged earnings, saved in this browser's
 * localStorage (mirrors pipeline.ts's exact pattern). */

type GoalState = { monthlyGoal?: number; entries?: EarningsEntry[] };

const STORAGE_KEY = "product-radar:earnings-goal";

let memory: GoalState | null = null;

function loadState(): GoalState {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    memory = parsed && typeof parsed === "object" ? (parsed as GoalState) : {};
  } catch {
    memory = {};
  }
  return memory;
}

function saveState(state: GoalState): void {
  memory = state;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable: keep the in-memory copy for this visit
  }
}

export function getMonthlyGoal(): number | null {
  return loadState().monthlyGoal ?? null;
}

export function setMonthlyGoal(amount: number): void {
  const state = loadState();
  saveState({ ...state, monthlyGoal: amount });
}

export function getEntries(): EarningsEntry[] {
  return loadState().entries ?? [];
}

export function addEntry(amount: number, date: string): void {
  const state = loadState();
  const entry: EarningsEntry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, date, amount };
  saveState({ ...state, entries: [...(state.entries ?? []), entry] });
}

export function deleteEntry(id: string): void {
  const state = loadState();
  saveState({ ...state, entries: (state.entries ?? []).filter((e) => e.id !== id) });
}
