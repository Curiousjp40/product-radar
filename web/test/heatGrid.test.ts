import assert from "node:assert/strict";
import { test } from "node:test";

import { cellIntensity, findCell, isBestCell, maxMedianUnits } from "../src/heatGrid.ts";

function cell(weekday: number, hourStart: number, medianUnits: number) {
  return { weekday, hour_start: hourStart, hour_end: hourStart + 2, median_units: medianUnits, sample_size: 1 };
}

test("maxMedianUnits finds the busiest cell", () => {
  assert.equal(maxMedianUnits([cell(0, 8, 5), cell(1, 20, 30), cell(2, 12, 10)]), 30);
});

test("maxMedianUnits is 0 for an empty grid", () => {
  assert.equal(maxMedianUnits([]), 0);
});

test("cellIntensity scales relative to the group's own max", () => {
  assert.equal(cellIntensity(cell(0, 8, 15), 30), 0.5);
  assert.equal(cellIntensity(cell(0, 8, 30), 30), 1);
});

test("cellIntensity is 0 when the group has no data", () => {
  assert.equal(cellIntensity(cell(0, 8, 5), 0), 0);
});

test("isBestCell matches the best hour and one of the best weekdays", () => {
  const best = { hour_start: 20, hour_end: 22, best_weekdays: [0, 2], sample_size: 10, used_organic_only: false, median_duration_minutes: 60 };
  assert.equal(isBestCell(cell(0, 20, 10), best), true);
  assert.equal(isBestCell(cell(2, 20, 10), best), true);
  assert.equal(isBestCell(cell(1, 20, 10), best), false);
  assert.equal(isBestCell(cell(0, 8, 10), best), false);
});

test("isBestCell is false with no best time", () => {
  assert.equal(isBestCell(cell(0, 20, 10), null), false);
});

test("findCell returns the matching cell or null", () => {
  const cells = [cell(0, 8, 5), cell(1, 20, 30)];
  assert.deepEqual(findCell(cells, 1, 20), cell(1, 20, 30));
  assert.equal(findCell(cells, 5, 5), null);
});
