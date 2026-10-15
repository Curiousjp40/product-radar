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

// A product's FastMoss category assignment is sometimes wrong for what the
// title actually is (real case: a "Silent Vibration Wrist-Worn Device"
// sleep gadget got tagged home_decor and paired with a dining chair) --
// require the title to contain at least one of that category's own
// keywords before it's eligible to appear in a combo at all. A category
// with no keyword list configured is left unfiltered (passes through).
function fitsCategory(title: string, category: string, categoryFitKeywords: Record<string, string[]>): boolean {
  const keywords = categoryFitKeywords[category];
  if (!keywords || keywords.length === 0) return true;
  const lowered = title.toLowerCase();
  return keywords.some((kw) => lowered.includes(kw.toLowerCase()));
}

// Only pairs this week's picks across config/hooks.yaml's explicit
// combo_pairs whitelist -- when both categories in a pair have at least one
// pick that actually fits its category, the highest-earning fitting pick
// from each side is paired.
export function findCombos<T extends ComboCandidate>(
  picks: T[],
  comboPairs: ComboPair[],
  categoryFitKeywords: Record<string, string[]>,
): Combo<T>[] {
  const byCategory = new Map<string, T[]>();
  for (const p of picks) {
    if (!fitsCategory(p.clean_title, p.category, categoryFitKeywords)) continue;
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
