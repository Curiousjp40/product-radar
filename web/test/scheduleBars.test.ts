import assert from "node:assert";
import { test } from "node:test";
import { aggregateByHour, aggregateByWeekday, bestBarIndex } from "../src/scheduleBars.ts";
import type { HeatGridCell } from "../src/types.ts";

function cell(weekday: number, hourStart: number, medianUnits: number, sampleSize = 10): HeatGridCell {
  return { weekday, hour_start: hourStart, hour_end: hourStart + 2, median_units: medianUnits, sample_size: sampleSize };
}

test("aggregateByWeekday returns 7 bars, one per weekday, taking the peak slot per day", () => {
  const bars = aggregateByWeekday([cell(0, 8, 5), cell(0, 20, 12), cell(2, 8, 20)]);
  assert.strictEqual(bars.length, 7);
  assert.strictEqual(bars[0].value, 12);
  assert.strictEqual(bars[0].sampleSize, 20);
  assert.strictEqual(bars[2].value, 20);
  assert.strictEqual(bars[1].value, 0);
});

test("aggregateByHour returns one bar per requested hour slot, peak across weekdays", () => {
  const bars = aggregateByHour([cell(0, 8, 5), cell(3, 8, 30), cell(1, 20, 15)], [8, 20]);
  assert.deepStrictEqual(
    bars.map((b) => b.value),
    [30, 15],
  );
});

test("bestBarIndex picks the highest-value bar that meets the sample-size floor", () => {
  const bars = [
    { value: 50, sampleSize: 1 }, // below floor, ignored even though highest value
    { value: 10, sampleSize: 5 },
    { value: 20, sampleSize: 5 },
  ];
  assert.strictEqual(bestBarIndex(bars, 3), 2);
});

test("bestBarIndex returns null when nothing meets the sample-size floor", () => {
  assert.strictEqual(bestBarIndex([{ value: 10, sampleSize: 1 }], 3), null);
});
