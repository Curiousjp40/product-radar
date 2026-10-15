import assert from "node:assert";
import { test } from "node:test";
import {
  bestCategoryForGoal,
  earningsProgress,
  earningsThisMonth,
  videosNeeded,
} from "../src/earningsGoalLogic.ts";

test("earningsThisMonth sums only entries in the given month/year", () => {
  const entries = [
    { id: "1", date: "2026-10-05", amount: 20 },
    { id: "2", date: "2026-10-28", amount: 30 },
    { id: "3", date: "2026-09-30", amount: 999 },
    { id: "4", date: "2025-10-15", amount: 999 },
  ];
  assert.strictEqual(earningsThisMonth(entries, new Date(2026, 9, 15)), 50);
});

test("earningsProgress is null when no goal is set", () => {
  assert.strictEqual(earningsProgress(null, 100), null);
  assert.strictEqual(earningsProgress(0, 100), null);
});

test("earningsProgress computes earned/remaining/pct, capping pct at 100", () => {
  assert.deepStrictEqual(earningsProgress(200, 50), { goal: 200, earned: 50, remaining: 150, pct: 25 });
  assert.deepStrictEqual(earningsProgress(200, 300), { goal: 200, earned: 300, remaining: 0, pct: 100 });
});

test("videosNeeded rounds up and handles zero/negative edge cases", () => {
  assert.strictEqual(videosNeeded(100, 30), 4);
  assert.strictEqual(videosNeeded(0, 30), 0);
  assert.strictEqual(videosNeeded(100, 0), 0);
});

test("bestCategoryForGoal picks the highest earnings_per_sale, null when empty", () => {
  assert.strictEqual(bestCategoryForGoal([]), null);
  const picks = [
    { category: "fajas", category_label_es: "Fajas", category_label_en: "Shapewear", earnings_per_sale: 3.5 },
    { category: "muebles", category_label_es: "Muebles", category_label_en: "Furniture", earnings_per_sale: 8.2 },
  ];
  assert.strictEqual(bestCategoryForGoal(picks)?.category, "muebles");
});
