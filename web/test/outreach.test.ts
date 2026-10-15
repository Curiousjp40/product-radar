import assert from "node:assert";
import { test } from "node:test";
import { outreachMessage, outreachShops } from "../src/outreach.ts";

function makeCandidate(overrides: Record<string, unknown>) {
  return {
    product_id: "p",
    shop_name: "Shop",
    clean_title: "Product",
    commission_rate: 0.1,
    creator_count: 5,
    earnings_per_sale: 1,
    fastmoss_url: "",
    has_enrichment: true,
    ...overrides,
  };
}

test("outreachShops excludes candidates without enrichment or creator_count", () => {
  const candidates = [
    makeCandidate({ shop_name: "NoEnrichment", commission_rate: 0.3, creator_count: 2, has_enrichment: false }),
    makeCandidate({ shop_name: "NoCreatorCount", commission_rate: 0.3, creator_count: null }),
  ];
  assert.deepStrictEqual(outreachShops(candidates, 0.5, 0.5), []);
});

test("outreachShops only qualifies shops in both the top-commission and bottom-creator-count halves", () => {
  const candidates = [
    makeCandidate({ product_id: "a", shop_name: "HighCommissionCrowded", commission_rate: 0.3, creator_count: 500 }),
    makeCandidate({ product_id: "b", shop_name: "LowCommissionFew", commission_rate: 0.05, creator_count: 5 }),
    makeCandidate({ product_id: "c", shop_name: "GoodShop", commission_rate: 0.25, creator_count: 10 }),
    makeCandidate({ product_id: "d", shop_name: "AlsoOkShop", commission_rate: 0.2, creator_count: 20 }),
  ];
  const result = outreachShops(candidates, 0.5, 0.5);
  const names = result.map((s) => s.shop_name);
  assert.ok(!names.includes("HighCommissionCrowded")); // commission high, but creator_count too high
  assert.ok(!names.includes("LowCommissionFew")); // creator_count low, but commission too low
});

test("outreachShops picks the highest-earning product per qualifying shop and sorts by commission desc", () => {
  const candidates = [
    makeCandidate({ product_id: "a", shop_name: "GoodShop", commission_rate: 0.25, creator_count: 3, earnings_per_sale: 2 }),
    makeCandidate({ product_id: "b", shop_name: "GoodShop", commission_rate: 0.25, creator_count: 3, earnings_per_sale: 6 }),
    makeCandidate({ product_id: "c", shop_name: "BetterShop", commission_rate: 0.4, creator_count: 1, earnings_per_sale: 3 }),
  ];
  // fractions of 1.0 so every shop qualifies, isolating the per-shop
  // highest-earner pick and the commission-desc sort from the percentile
  // filtering (covered by the test above).
  const result = outreachShops(candidates, 1.0, 1.0);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].shop_name, "BetterShop"); // higher avg_commission_rate sorts first
  assert.strictEqual(result[1].representative_product.product_id, "b"); // highest earner in GoodShop
});

test("outreachMessage includes the shop, product, commission and her signature, in the requested language", () => {
  const es = outreachMessage("Casa Linda", "Lámpara", 25, "es");
  assert.match(es, /Casa Linda/);
  assert.match(es, /Lámpara/);
  assert.match(es, /25%/);
  assert.match(es, /Roxie, @roxm___/);

  const en = outreachMessage("Casa Linda", "Lamp", 25, "en");
  assert.match(en, /Casa Linda/);
  assert.match(en, /Roxie, @roxm___/);
});
