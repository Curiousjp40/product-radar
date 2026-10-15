import assert from "node:assert/strict";
import { test } from "node:test";

import {
  daysUntilPostBy,
  defaultPostByDate,
  hasUrgentSamples,
  sampleUrgency,
  samplesSummary,
  samplesToCsv,
  sortSamplesByUrgency,
  type Sample,
} from "../src/samplesLogic.ts";

function makeSample(overrides: Partial<Sample>): Sample {
  return {
    id: "s1",
    name: "Test Product",
    date_received: "2026-10-01",
    value_usd: 20,
    post_by_date: "2026-10-15",
    notes: "",
    status: "received",
    ...overrides,
  };
}

test("defaultPostByDate adds 14 days", () => {
  assert.equal(defaultPostByDate("2026-10-01"), "2026-10-15");
});

test("defaultPostByDate crosses a month boundary correctly", () => {
  assert.equal(defaultPostByDate("2026-10-25"), "2026-11-08");
});

test("daysUntilPostBy is positive before, zero on, negative after", () => {
  const today = new Date("2026-10-10T18:00:00Z"); // time of day must not matter
  assert.equal(daysUntilPostBy("2026-10-15", today), 5);
  assert.equal(daysUntilPostBy("2026-10-10", today), 0);
  assert.equal(daysUntilPostBy("2026-10-05", today), -5);
});

test("sampleUrgency: posted is always posted regardless of date", () => {
  const sample = makeSample({ status: "posted", post_by_date: "2026-10-01" });
  assert.equal(sampleUrgency(sample, new Date("2026-10-15")), "posted");
});

test("sampleUrgency: overdue, due_soon, ok thresholds", () => {
  const today = new Date("2026-10-10T00:00:00Z");
  assert.equal(sampleUrgency(makeSample({ post_by_date: "2026-10-09" }), today), "overdue");
  assert.equal(sampleUrgency(makeSample({ post_by_date: "2026-10-10" }), today), "due_soon");
  assert.equal(sampleUrgency(makeSample({ post_by_date: "2026-10-13" }), today), "due_soon");
  assert.equal(sampleUrgency(makeSample({ post_by_date: "2026-10-14" }), today), "ok");
});

test("sortSamplesByUrgency: overdue first, then by days remaining, posted last", () => {
  const today = new Date("2026-10-10T00:00:00Z");
  const samples = [
    makeSample({ id: "ok", post_by_date: "2026-10-20" }),
    makeSample({ id: "posted", status: "posted", post_by_date: "2026-10-05" }),
    makeSample({ id: "overdue_far", post_by_date: "2026-09-01" }),
    makeSample({ id: "overdue_close", post_by_date: "2026-10-09" }),
    makeSample({ id: "due_soon", post_by_date: "2026-10-11" }),
  ];
  const sorted = sortSamplesByUrgency(samples, today).map((s) => s.id);
  assert.deepEqual(sorted, ["overdue_far", "overdue_close", "due_soon", "ok", "posted"]);
});

test("samplesSummary: pending excludes posted, overdue counts only real overdues, yearly total is by date_received", () => {
  const today = new Date("2026-10-10T00:00:00Z");
  const samples = [
    makeSample({ id: "a", status: "received", post_by_date: "2026-10-05", value_usd: 10, date_received: "2026-01-05" }),
    makeSample({ id: "b", status: "posted", post_by_date: "2026-10-05", value_usd: 25, date_received: "2026-03-01" }),
    makeSample({ id: "c", status: "filmed", post_by_date: "2026-10-20", value_usd: 15, date_received: "2025-12-20" }),
  ];
  const summary = samplesSummary(samples, today);
  assert.equal(summary.pending, 2); // a, c (not posted b)
  assert.equal(summary.overdue, 1); // only a is overdue
  assert.equal(summary.totalValueThisYear, 35); // a (10) + b (25), c is 2025
});

test("hasUrgentSamples: true within the banner threshold, false otherwise", () => {
  const today = new Date("2026-10-10T00:00:00Z");
  assert.equal(hasUrgentSamples([makeSample({ post_by_date: "2026-10-11" })], today), true); // 1 day away
  assert.equal(hasUrgentSamples([makeSample({ post_by_date: "2026-10-05" })], today), true); // overdue
  assert.equal(hasUrgentSamples([makeSample({ post_by_date: "2026-10-20" })], today), false);
  assert.equal(hasUrgentSamples([makeSample({ status: "posted", post_by_date: "2026-10-05" })], today), false);
});

test("samplesToCsv includes a header row and escapes commas/quotes", () => {
  const samples = [makeSample({ name: 'Sofa, "Grey"', notes: "line1\nline2" })];
  const csv = samplesToCsv(samples);
  const lines = csv.split("\n");
  assert.equal(lines[0], "name,date_received,value_usd,post_by_date,status,tiktok_url,notes");
  assert.ok(lines[1].includes('"Sofa, ""Grey"""'));
});
