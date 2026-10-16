import assert from "node:assert";
import { test } from "node:test";
import {
  bestCategoryForGoal,
  dayStreak,
  earningsProgress,
  earningsThisMonth,
  monthKey,
  monthlyPace,
  newlyCrossedMilestones,
  salesNeededForItems,
  suggestNextGoal,
  videosNeeded,
  videosPostedThisWeek,
  weekStreak,
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

test("monthlyPace projects the full month from the daily average so far", () => {
  // Oct 2026 has 31 days; 10 days elapsed, $100 earned -> $10/day avg.
  const today = new Date(2026, 9, 10);
  const pace = monthlyPace(400, 100, today);
  assert.strictEqual(pace.daysInMonth, 31);
  assert.strictEqual(pace.daysElapsed, 10);
  assert.strictEqual(pace.daysLeft, 21);
  assert.strictEqual(pace.dailyAverage, 10);
  assert.strictEqual(pace.projectedTotal, 310);
  assert.strictEqual(pace.onPace, false); // 310 < 400
});

test("monthlyPace marks onPace true when the projection clears the goal", () => {
  const today = new Date(2026, 9, 10);
  const pace = monthlyPace(200, 100, today);
  assert.strictEqual(pace.projectedTotal, 310);
  assert.strictEqual(pace.onPace, true);
});

test("salesNeededForItems ranks by earnings per sale and rounds up", () => {
  const items = [
    { label: "Faja", earningsPerSale: 8.45 },
    { label: "Sofa", earningsPerSale: 21.0 },
    { label: "Low value", earningsPerSale: 1.0 },
    { label: "Zero", earningsPerSale: 0 },
  ];
  const result = salesNeededForItems(100, items, 3);
  assert.strictEqual(result.length, 3);
  assert.strictEqual(result[0].label, "Sofa");
  assert.strictEqual(result[0].salesNeeded, 5); // ceil(100/21)
  assert.strictEqual(result[1].label, "Faja");
  assert.strictEqual(result[1].salesNeeded, 12); // ceil(100/8.45)
});

test("salesNeededForItems returns empty once the goal is already met", () => {
  assert.deepStrictEqual(salesNeededForItems(0, [{ label: "A", earningsPerSale: 5 }]), []);
});

test("videosPostedThisWeek counts only dates inside the current Mon-Sun week", () => {
  // 2026-10-15 is a Thursday; that week is Oct 12 (Mon) - Oct 18 (Sun).
  const today = new Date(2026, 9, 15);
  const dates = ["2026-10-12", "2026-10-18", "2026-10-11", "2026-10-19", null, undefined];
  assert.strictEqual(videosPostedThisWeek(dates, today), 2);
});

test("dayStreak counts consecutive days ending today or yesterday", () => {
  const today = new Date(2026, 9, 15);
  const dates = ["2026-10-13", "2026-10-14", "2026-10-15"];
  assert.strictEqual(dayStreak(dates, today), 3);
});

test("dayStreak tolerates today having nothing posted yet", () => {
  const today = new Date(2026, 9, 15);
  const dates = ["2026-10-13", "2026-10-14"]; // nothing posted today yet
  assert.strictEqual(dayStreak(dates, today), 2);
});

test("dayStreak is 0 when the most recent post was 2+ days ago", () => {
  const today = new Date(2026, 9, 15);
  const dates = ["2026-10-10"];
  assert.strictEqual(dayStreak(dates, today), 0);
});

test("weekStreak counts consecutive Mon-Sun weeks with at least one post", () => {
  const today = new Date(2026, 9, 15); // week of Oct 12
  const dates = ["2026-10-13", "2026-10-06", "2026-09-29"]; // this week, last week, 2 weeks ago
  assert.strictEqual(weekStreak(dates, today), 3);
});

test("weekStreak restarts quietly after a gap (no negative/shaming value)", () => {
  const today = new Date(2026, 9, 15);
  const dates = ["2026-09-01"]; // long ago, no current streak
  assert.strictEqual(weekStreak(dates, today), 0);
});

test("newlyCrossedMilestones flags first sale of the month", () => {
  const crossed = newlyCrossedMilestones(new Set(), 10, 50, 0);
  assert.ok(crossed.includes("first_sale_of_month"));
});

test("newlyCrossedMilestones does not re-flag an already-earned badge", () => {
  const crossed = newlyCrossedMilestones(new Set(["first_sale_of_month"]), 10, 50, 0);
  assert.ok(!crossed.includes("first_sale_of_month"));
});

test("newlyCrossedMilestones flags every monthly % threshold just crossed", () => {
  const crossed = newlyCrossedMilestones(new Set(), 80, 50, 2);
  assert.deepStrictEqual(crossed.sort(), ["monthly_25", "monthly_50", "monthly_75"].sort());
});

test("newlyCrossedMilestones flags lifetime thresholds just crossed", () => {
  const crossed = newlyCrossedMilestones(new Set(), 10, 120, 2);
  assert.ok(crossed.includes("lifetime_100"));
  assert.ok(!crossed.includes("lifetime_500"));
});

test("suggestNextGoal is last month's result +15%, rounded to the nearest 10", () => {
  assert.strictEqual(suggestNextGoal(400), 460); // 400*1.15=460
  assert.strictEqual(suggestNextGoal(0), 0);
});

test("monthKey formats as yyyy-mm", () => {
  assert.strictEqual(monthKey(new Date(2026, 0, 5)), "2026-01");
  assert.strictEqual(monthKey(new Date(2026, 9, 5)), "2026-10");
});
