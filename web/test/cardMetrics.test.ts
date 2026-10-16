import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeVerdict,
  DEFAULT_VERDICT_THRESHOLDS,
  monthlyEstimateRange,
  salesPerCreator,
  salesToReachAmount,
  trendArrow,
  weeklyUnitsChangePct,
} from "../src/cardMetrics.ts";

test("salesPerCreator divides units by creator count", () => {
  assert.equal(salesPerCreator(100, 10), 10);
});

test("salesPerCreator returns null when creator count is unknown or zero", () => {
  assert.equal(salesPerCreator(100, null), null);
  assert.equal(salesPerCreator(100, 0), null);
});

test("monthlyEstimateRange is +/-30% of ev_typical, rounded", () => {
  assert.deepEqual(monthlyEstimateRange(100), { low: 70, high: 130 });
});

test("salesToReachAmount rounds up and handles non-positive inputs", () => {
  assert.equal(salesToReachAmount(100, 8.45), 12);
  assert.equal(salesToReachAmount(100, 0), 0);
  assert.equal(salesToReachAmount(0, 5), 0);
});

test("weeklyUnitsChangePct needs a full 14-day series", () => {
  assert.equal(weeklyUnitsChangePct([1, 2, 3]), null);
});

test("weeklyUnitsChangePct compares the two 7-day halves, floored at 50 like the backend's wow", () => {
  const prior7 = Array(7).fill(10); // sum 70
  const last7 = Array(7).fill(20); // sum 140
  const pct = weeklyUnitsChangePct([...prior7, ...last7]);
  assert.equal(pct, 100); // (140-70)/max(70,50) = 1.0 -> 100%
});

test("weeklyUnitsChangePct floors a tiny prior-week base at 50 to avoid wild swings", () => {
  const prior7 = [1, 0, 0, 0, 0, 0, 0]; // sum 1
  const last7 = [5, 0, 0, 0, 0, 0, 0]; // sum 5
  const pct = weeklyUnitsChangePct([...prior7, ...last7]);
  assert.equal(pct, 8); // (5-1)/max(1,50) = 4/50 = 8%, not 400%
});

test("trendArrow classifies up/down/flat around a 5% band", () => {
  assert.equal(trendArrow(20), "up");
  assert.equal(trendArrow(-20), "down");
  assert.equal(trendArrow(2), "flat");
  assert.equal(trendArrow(null), "flat");
});

test("computeVerdict: muy_lleno always loses regardless of score", () => {
  const v = computeVerdict(90, 10, "muy_lleno");
  assert.deepEqual(v, { label: "pasalo", reason: "muy_lleno" });
});

test("computeVerdict: low pay is flagged even with a decent score", () => {
  const v = computeVerdict(60, 1.0, "normal");
  assert.deepEqual(v, { label: "tal_vez", reason: "paga_poco" });
});

test("computeVerdict: low pay AND low score is a clear pasalo", () => {
  const v = computeVerdict(10, 1.0, "normal");
  assert.deepEqual(v, { label: "pasalo", reason: "paga_poco" });
});

test("computeVerdict: entra_ya with a middling score still recommends it", () => {
  const v = computeVerdict(35, 5.0, "entra_ya");
  assert.deepEqual(v, { label: "vale_la_pena", reason: "mucha_demanda_pocas_creadoras" });
});

test("computeVerdict: high score and real pay is vale_la_pena with no special reason", () => {
  const v = computeVerdict(70, 5.0, "normal");
  assert.deepEqual(v, { label: "vale_la_pena", reason: null });
});

test("computeVerdict: low score alone (no other red flags) is pasalo with no special reason", () => {
  const v = computeVerdict(10, 5.0, "normal");
  assert.deepEqual(v, { label: "pasalo", reason: null });
});

test("computeVerdict: middling score alone is tal_vez", () => {
  const v = computeVerdict(40, 5.0, "normal");
  assert.deepEqual(v, { label: "tal_vez", reason: null });
});

test("computeVerdict respects custom thresholds", () => {
  const v = computeVerdict(50, 5.0, "normal", { ...DEFAULT_VERDICT_THRESHOLDS, minScoreValeLaPena: 45 });
  assert.equal(v.label, "vale_la_pena");
});
