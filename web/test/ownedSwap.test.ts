import assert from "node:assert/strict";
import { test } from "node:test";

import { applyOwnedSwap } from "../src/ownedSwap.ts";

function cand(product_id: string, category = "cat", shop_name = `shop-${product_id}`) {
  return { product_id, category, shop_name };
}

test("applyOwnedSwap is a no-op when nothing is owned", () => {
  const picks = [cand("a"), cand("b")];
  const pool = [cand("a"), cand("b"), cand("c")];
  const result = applyOwnedSwap(picks, pool, new Set());
  assert.deepEqual(result.map((p) => p.product_id), ["a", "b"]);
});

test("applyOwnedSwap drops the owned pick and backfills from the pool", () => {
  const picks = [cand("a"), cand("b")];
  const pool = [cand("a"), cand("b"), cand("c"), cand("d")];
  const result = applyOwnedSwap(picks, pool, new Set(["a"]));
  assert.deepEqual(result.map((p) => p.product_id), ["b", "c"]);
});

test("applyOwnedSwap backfill respects max_per_category", () => {
  const picks = [cand("a", "shoes"), cand("b", "shoes")];
  const pool = [cand("a", "shoes"), cand("b", "shoes"), cand("c", "shoes"), cand("d", "dresses")];
  const result = applyOwnedSwap(picks, pool, new Set(["a"]), 1);
  // "b" alone already fills shoes' cap of 1, so "c" (also shoes) must be
  // skipped in favor of "d".
  assert.deepEqual(result.map((p) => p.product_id), ["b", "d"]);
});

test("applyOwnedSwap backfill respects max_per_shop", () => {
  const picks = [cand("a", "cat", "shopX"), cand("b", "cat", "shopX")];
  const pool = [cand("a", "cat", "shopX"), cand("b", "cat", "shopX"), cand("c", "cat", "shopX"), cand("d", "cat", "shopY")];
  const result = applyOwnedSwap(picks, pool, new Set(["a"]), 10, 1);
  // "b" alone already fills shopX's cap of 1, so "c" (same shop) must be
  // skipped in favor of "d".
  assert.deepEqual(result.map((p) => p.product_id), ["b", "d"]);
});

test("applyOwnedSwap shrinks the list when no eligible backfill exists", () => {
  const picks = [cand("a"), cand("b")];
  const pool = [cand("a"), cand("b")];
  const result = applyOwnedSwap(picks, pool, new Set(["a"]));
  assert.deepEqual(result.map((p) => p.product_id), ["b"]);
});

test("applyOwnedSwap never re-adds an already-owned product from the pool", () => {
  const picks = [cand("a"), cand("b")];
  const pool = [cand("a"), cand("b"), cand("c")];
  const result = applyOwnedSwap(picks, pool, new Set(["a", "c"]));
  assert.deepEqual(result.map((p) => p.product_id), ["b"]);
});
