import assert from "node:assert";
import { test } from "node:test";
import { findCombos } from "../src/combos.ts";

const PAIRS = [
  { categories: ["shapewear", "dresses"] as [string, string], idea_es: "idea es", idea_en: "idea en" },
  { categories: ["sets", "shoes"] as [string, string], idea_es: "idea2 es", idea_en: "idea2 en" },
  { categories: ["furniture", "home_decor"] as [string, string], idea_es: "idea3 es", idea_en: "idea3 en" },
];

const NO_KEYWORDS = {};

const REAL_KEYWORDS = {
  furniture: ["chair", "table", "sofa", "bed"],
  home_decor: ["decor", "rug", "candle", "lamp"],
};

test("findCombos pairs the highest-earning pick from each category", () => {
  const picks = [
    { product_id: "1", category: "shapewear", clean_title: "Faja A", earnings_per_sale: 2 },
    { product_id: "2", category: "shapewear", clean_title: "Faja B", earnings_per_sale: 5 },
    { product_id: "3", category: "dresses", clean_title: "Vestido A", earnings_per_sale: 3 },
  ];
  const combos = findCombos(picks, PAIRS, NO_KEYWORDS);
  assert.strictEqual(combos.length, 1);
  assert.strictEqual(combos[0].a.product_id, "2"); // the $5 shapewear pick, not the $2 one
  assert.strictEqual(combos[0].b.product_id, "3");
  assert.strictEqual(combos[0].combinedEarnings, 8);
});

test("findCombos skips a pair when either category has no pick this week", () => {
  const picks = [{ product_id: "1", category: "shapewear", clean_title: "Faja A", earnings_per_sale: 2 }];
  assert.deepStrictEqual(findCombos(picks, PAIRS, NO_KEYWORDS), []);
});

test("findCombos returns a combo per matching pair, independently", () => {
  const picks = [
    { product_id: "1", category: "shapewear", clean_title: "Faja", earnings_per_sale: 2 },
    { product_id: "2", category: "dresses", clean_title: "Vestido", earnings_per_sale: 3 },
    { product_id: "3", category: "sets", clean_title: "Conjunto", earnings_per_sale: 4 },
    { product_id: "4", category: "shoes", clean_title: "Zapatos", earnings_per_sale: 1 },
  ];
  const combos = findCombos(picks, PAIRS, NO_KEYWORDS);
  assert.strictEqual(combos.length, 2);
});

test("findCombos drops a product whose title doesn't fit its category (real case: a gadget miscategorized as home_decor)", () => {
  const picks = [
    { product_id: "1", category: "furniture", clean_title: "Dining Chair Modern Upholstered", earnings_per_sale: 10 },
    { product_id: "2", category: "home_decor", clean_title: "Onyx Silent Vibration Wrist-Worn Device", earnings_per_sale: 20 },
  ];
  // product 2 is tagged home_decor but its title matches none of home_decor's
  // keywords -- it must not appear in any combo.
  assert.deepStrictEqual(findCombos(picks, PAIRS, REAL_KEYWORDS), []);
});

test("findCombos keeps a product whose title genuinely fits its category", () => {
  const picks = [
    { product_id: "1", category: "furniture", clean_title: "Dining Chair Modern Upholstered", earnings_per_sale: 10 },
    { product_id: "2", category: "home_decor", clean_title: "Scented Candle Decor Set", earnings_per_sale: 5 },
  ];
  const combos = findCombos(picks, PAIRS, REAL_KEYWORDS);
  assert.strictEqual(combos.length, 1);
  assert.strictEqual(combos[0].a.product_id, "1");
  assert.strictEqual(combos[0].b.product_id, "2");
});

test("findCombos does not filter a category with no keyword list configured", () => {
  const picks = [
    { product_id: "1", category: "shapewear", clean_title: "Anything Goes Here", earnings_per_sale: 2 },
    { product_id: "2", category: "dresses", clean_title: "Also Unfiltered", earnings_per_sale: 3 },
  ];
  const combos = findCombos(picks, PAIRS, REAL_KEYWORDS); // REAL_KEYWORDS has no shapewear/dresses entries
  assert.strictEqual(combos.length, 1);
});
