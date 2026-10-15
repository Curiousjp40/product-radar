// H1 (monthly earnings goal), part of the 2026-10-15 creator-workflow
// upgrade. Pure functions, no imports -- state lives in earningsGoal.ts
// (localStorage, mirroring pipeline.ts's pattern).

export interface EarningsEntry {
  id: string;
  date: string; // ISO yyyy-mm-dd
  amount: number;
}

export interface GoalProgress {
  goal: number;
  earned: number;
  remaining: number;
  pct: number; // 0-100, capped
}

export function earningsThisMonth(entries: EarningsEntry[], today: Date): number {
  const y = today.getFullYear();
  const m = today.getMonth();
  return entries
    .filter((e) => {
      const d = new Date(e.date);
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
