import assert from "node:assert";
import { test } from "node:test";
import { findCombos } from "../src/combos.ts";

const PAIRS = [
  { categories: ["shapewear", "dresses"] as [string, string], idea_es: "idea es", idea_en: "idea en" },
  { categories: ["sets", "shoes"] as [string, string], idea_es: "idea2 es", idea_en: "idea2 en" },
];

test("findCombos pairs the highest-earning pick from each category", () => {
  const picks = [
    { product_id: "1", category: "shapewear", clean_title: "Faja A", earnings_per_sale: 2 },
    { product_id: "2", category: "shapewear", clean_title: "Faja B", earnings_per_sale: 5 },
    { product_id: "3", category: "dresses", clean_title: "Vestido A", earnings_per_sale: 3 },
  ];
  const combos = findCombos(picks, PAIRS);
  assert.strictEqual(combos.length, 1);
  assert.strictEqual(combos[0].a.product_id, "2"); // the $5 shapewear pick, not the $2 one
  assert.strictEqual(combos[0].b.product_id, "3");
  assert.strictEqual(combos[0].combinedEarnings, 8);
});

test("findCombos skips a pair when either category has no pick this week", () => {
  const picks = [{ product_id: "1", category: "shapewear", clean_title: "Faja A", earnings_per_sale: 2 }];
  assert.deepStrictEqual(findCombos(picks, PAIRS), []);
});

test("findCombos returns a combo per matching pair, independently", () => {
  const picks = [
    { product_id: "1", category: "shapewear", clean_title: "Faja", earnings_per_sale: 2 },
    { product_id: "2", category: "dresses", clean_title: "Vestido", earnings_per_sale: 3 },
    { product_id: "3", category: "sets", clean_title: "Conjunto", earnings_per_sale: 4 },
    { product_id: "4", category: "shoes", clean_title: "Zapatos", earnings_per_sale: 1 },
  ];
  const combos = findCombos(picks, PAIRS);
  assert.strictEqual(combos.length, 2);
});
