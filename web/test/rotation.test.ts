import assert from "node:assert/strict";
import { test } from "node:test";

import { productsToFilmToday } from "../src/rotation.ts";

test("productsToFilmToday is deterministic for the same day", () => {
  const picks = ["a", "b", "c", "d", "e"];
  const today = new Date("2026-10-15T12:00:00Z");
  const first = productsToFilmToday(picks, today, new Set(), 3);
  const second = productsToFilmToday(picks, today, new Set(), 3);
  assert.deepEqual(first, second);
  assert.equal(first.length, 3);
});

test("productsToFilmToday defaults to 9 (1 hero + 8 also-good)", () => {
  const picks = Array.from({ length: 20 }, (_, i) => `p${i}`);
  const result = productsToFilmToday(picks, new Date("2026-10-15T00:00:00Z"), new Set());
  assert.equal(result.length, 9);
});

test("productsToFilmToday rotates to a different set on a different day", () => {
  const picks = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const day1 = productsToFilmToday(picks, new Date("2026-10-15T00:00:00Z"), new Set(), 3);
  const day2 = productsToFilmToday(picks, new Date("2026-10-16T00:00:00Z"), new Set(), 3);
  assert.notDeepEqual(day1, day2);
});

test("productsToFilmToday skips excluded (already-posted) ids", () => {
  const picks = ["a", "b", "c"];
  const result = productsToFilmToday(picks, new Date("2026-10-15T00:00:00Z"), new Set(["a", "b"]), 3);
  assert.deepEqual(result, ["c"]);
});

test("productsToFilmToday returns empty when everything is excluded", () => {
  const picks = ["a", "b"];
  const result = productsToFilmToday(picks, new Date("2026-10-15T00:00:00Z"), new Set(["a", "b"]));
  assert.deepEqual(result, []);
});

test("productsToFilmToday never returns more than count, even with plenty eligible", () => {
  const picks = Array.from({ length: 20 }, (_, i) => `p${i}`);
  const result = productsToFilmToday(picks, new Date("2026-10-15T00:00:00Z"), new Set(), 3);
  assert.equal(result.length, 3);
});

test("productsToFilmToday wraps around the eligible list", () => {
  // every product_id must still be reachable across enough days -- the
  // rotation shouldn't get stuck always showing the same prefix.
  const picks = ["a", "b", "c"];
  const seenAcrossDays = new Set<string>();
  for (let d = 0; d < 10; d++) {
    const result = productsToFilmToday(picks, new Date(Date.UTC(2026, 9, 15 + d)), new Set(), 1);
    result.forEach((id) => seenAcrossDays.add(id));
  }
  assert.deepEqual(seenAcrossDays, new Set(picks));
});
