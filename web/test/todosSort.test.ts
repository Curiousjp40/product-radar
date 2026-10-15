import assert from "node:assert";
import { test } from "node:test";
import { sortCandidates } from "../src/todosSort.ts";
import type { Candidate } from "../src/types.ts";

function makeCandidate(overrides: Partial<Candidate>): Candidate {
  return {
    product_id: "p",
    title: "t",
    clean_title: "t",
    image_url: "",
    category: "cat",
    category_label_es: "Cat",
    category_label_en: "Cat",
    group: "fashion",
    shop_name: "shop",
    stage: "rising",
    rank: 1,
    price: 10,
    commission_rate: 0.1,
    earnings_per_sale: 1,
    units_7d: 100,
    units_total: 1000,
    score: 50,
    ev_typical: 1,
    daily_units: [],
    is_pick: false,
    has_enrichment: true,
    suspicious: false,
    fastmoss_url: "",
    tiktok_search_url: "",
    saturation_badge: null,
    ...overrides,
  };
}

test("sortCandidates: units mode sorts by units_7d descending", () => {
  const items = [makeCandidate({ product_id: "a", units_7d: 50 }), makeCandidate({ product_id: "b", units_7d: 200 })];
  const sorted = sortCandidates("units", items);
  assert.deepStrictEqual(sorted.map((c) => c.product_id), ["b", "a"]);
});

test("sortCandidates: commission mode sorts by commission_rate descending", () => {
  const items = [
    makeCandidate({ product_id: "a", commission_rate: 0.05 }),
    makeCandidate({ product_id: "b", commission_rate: 0.3 }),
  ];
  const sorted = sortCandidates("commission", items);
  assert.deepStrictEqual(sorted.map((c) => c.product_id), ["b", "a"]);
});

test("sortCandidates: earn mode sorts by earnings_per_sale descending", () => {
  const items = [
    makeCandidate({ product_id: "a", earnings_per_sale: 1 }),
    makeCandidate({ product_id: "b", earnings_per_sale: 5 }),
  ];
  const sorted = sortCandidates("earn", items);
  assert.deepStrictEqual(sorted.map((c) => c.product_id), ["b", "a"]);
});

test("sortCandidates: entra_ya mode puts entra_ya-level items first, then falls back to score", () => {
  const items = [
    makeCandidate({ product_id: "a", score: 90, saturation_badge: null }),
    makeCandidate({ product_id: "b", score: 10, saturation_badge: { level: "entra_ya", reason_es: "", reason_en: "" } }),
    makeCandidate({ product_id: "c", score: 80, saturation_badge: { level: "muy_lleno", reason_es: "", reason_en: "" } }),
  ];
  const sorted = sortCandidates("entra_ya", items);
  assert.deepStrictEqual(sorted.map((c) => c.product_id), ["b", "a", "c"]);
});

test("sortCandidates: score (default/recommended) mode sorts by score descending", () => {
  const items = [makeCandidate({ product_id: "a", score: 10 }), makeCandidate({ product_id: "b", score: 90 })];
  const sorted = sortCandidates("score", items);
  assert.deepStrictEqual(sorted.map((c) => c.product_id), ["b", "a"]);
});

test("sortCandidates does not mutate the input array", () => {
  const items = [makeCandidate({ product_id: "a", units_7d: 50 }), makeCandidate({ product_id: "b", units_7d: 200 })];
  sortCandidates("units", items);
  assert.deepStrictEqual(items.map((c) => c.product_id), ["a", "b"]);
});
