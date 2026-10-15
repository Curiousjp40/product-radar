import type { ComboPair } from "./types";

// H2 (combos/bundles), part of the 2026-10-15 creator-workflow upgrade.
export interface ComboCandidate {
  product_id: string;
  category: string;
  clean_title: string;
  earnings_per_sale: number;
}

export interface Combo<T extends ComboCandidate> {
  a: T;
  b: T;
  combinedEarnings: number;
  idea_es: string;
  idea_en: string;
}

// Only pairs this week's picks against config/hooks.yaml's static
// combo_pairs -- when both categories in a pair have at least one pick,
// the highest-earning pick from each side is paired.
export function findCombos<T extends ComboCandidate>(picks: T[], comboPairs: ComboPair[]): Combo<T>[] {
  const byCategory = new Map<string, T[]>();
  for (const p of picks) {
    const list = byCategory.get(p.category) ?? [];
    list.push(p);
    byCategory.set(p.category, list);
  }

  const combos: Combo<T>[] = [];
  for (const pair of comboPairs) {
    const [catA, catB] = pair.categories;
    const candidatesA = byCategory.get(catA);
    const candidatesB = byCategory.get(catB);
    if (!candidatesA?.length || !candidatesB?.length) continue;
    const a = candidatesA.reduce((best, p) => (p.earnings_per_sale > best.earnings_per_sale ? p : best));
    const b = candidatesB.reduce((best, p) => (p.earnings_per_sale > best.earnings_per_sale ? p : best));
    combos.push({ a, b, combinedEarnings: a.earnings_per_sale + b.earnings_per_sale, idea_es: pair.idea_es, idea_en: pair.idea_en });
  }
  return combos;
}
