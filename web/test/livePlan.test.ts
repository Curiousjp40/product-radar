import assert from "node:assert/strict";
import { test } from "node:test";

import { buildLivePlan, type LivePlanProduct } from "../src/livePlan.ts";

function p(id: string): LivePlanProduct {
  return {
    product_id: id,
    name: id,
    image_url: null,
    price: 10,
    earnings_per_sale: 1,
    talking_point: "",
    isOwned: false,
    liveUnitsSold: null,
    misProductoId: null,
    tiktokShopUrl: `https://www.tiktok.com/shop/pdp/${id}`,
  };
}

test("buildLivePlan prioritizes owned-ready products before top picks", () => {
  const result = buildLivePlan([p("a"), p("b")], [p("c"), p("d")], 8);
  assert.deepEqual(result.map((r) => r.product_id), ["a", "b", "c", "d"]);
});

test("buildLivePlan caps at maxProducts", () => {
  const owned = [p("a"), p("b"), p("c")];
  const picks = [p("d"), p("e"), p("f"), p("g"), p("h"), p("i")];
  const result = buildLivePlan(owned, picks, 5);
  assert.equal(result.length, 5);
  assert.deepEqual(result.map((r) => r.product_id), ["a", "b", "c", "d", "e"]);
});

test("buildLivePlan dedupes a product that appears in both lists", () => {
  const result = buildLivePlan([p("a")], [p("a"), p("b")], 8);
  assert.deepEqual(result.map((r) => r.product_id), ["a", "b"]);
});

test("buildLivePlan returns fewer than maxProducts when inventory is short", () => {
  const result = buildLivePlan([p("a")], [p("b")], 8);
  assert.equal(result.length, 2);
});

test("buildLivePlan handles empty inputs", () => {
  assert.deepEqual(buildLivePlan([], [], 8), []);
});
