import assert from "node:assert";
import { test } from "node:test";
import { displayCategories, eventKind, groupSeasonEvents, progressFraction, timelineSpan } from "../src/seasonLogic.ts";
import type { SeasonEvent } from "../src/types.ts";

function event(overrides: Partial<SeasonEvent>): SeasonEvent {
  return {
    id: "x",
    label_es: "X",
    label_en: "X",
    categories: [],
    film_start: null,
    film_end: null,
    event_date: null,
    ...overrides,
  };
}

const TODAY = new Date("2026-10-16T12:00:00Z");

test("groupSeasonEvents puts an event whose film window includes today in 'ahora'", () => {
  const ev = event({ id: "active", film_start: "2026-10-01", film_end: "2026-10-31" });
  const groups = groupSeasonEvents([ev], TODAY);
  assert.deepStrictEqual(groups.ahora, [ev]);
  assert.deepStrictEqual(groups.proximo, []);
});

test("groupSeasonEvents moves an event whose end anchor already passed into 'pasadas' (Ryan's redesign: collapse past events)", () => {
  const ev = event({ id: "past", film_start: "2026-01-01", film_end: "2026-01-31" });
  const groups = groupSeasonEvents([ev], TODAY);
  assert.deepStrictEqual(groups.ahora, []);
  assert.deepStrictEqual(groups.proximo, []);
  assert.deepStrictEqual(groups.mas_adelante, []);
  assert.deepStrictEqual(groups.pasadas, [ev]);
});

test("groupSeasonEvents uses event_date (not film_end) as the 'past' cutoff -- still filming after the real day counts as 'ahora'", () => {
  // Real case: BFCM's event_date (Black Friday) is well before film_end
  // (posting continues through Cyber Monday) -- "after the event date"
  // per Ryan's own wording, not after the longer filming window.
  const ev = event({ id: "bfcm", film_start: "2026-10-15", film_end: "2026-12-02", event_date: "2026-10-10" });
  const groups = groupSeasonEvents([ev], TODAY); // TODAY = 2026-10-16, after event_date but within film window
  assert.deepStrictEqual(groups.pasadas, [ev]);
});

test("groupSeasonEvents sorts 'pasadas' most-recently-passed first", () => {
  const older = event({ id: "older", film_end: "2026-01-01", event_date: "2026-01-01" });
  const recent = event({ id: "recent", film_end: "2026-10-01", event_date: "2026-10-01" });
  const groups = groupSeasonEvents([older, recent], TODAY);
  assert.deepStrictEqual(groups.pasadas, [recent, older]);
});

test("groupSeasonEvents puts the single nearest upcoming event in 'proximo', the rest in 'mas_adelante'", () => {
  const near = event({ id: "near", film_start: "2026-11-01", film_end: "2026-12-02" });
  const far = event({ id: "far", film_start: "2027-01-20", film_end: "2027-02-14" });
  const groups = groupSeasonEvents([far, near], TODAY);
  assert.deepStrictEqual(groups.proximo, [near]);
  assert.deepStrictEqual(groups.mas_adelante, [far]);
});

test("groupSeasonEvents treats an event with no dates yet as upcoming (TBD), sorted last", () => {
  const tbd = event({ id: "tbd" });
  const near = event({ id: "near", film_start: "2026-11-01", film_end: "2026-12-02" });
  const groups = groupSeasonEvents([tbd, near], TODAY);
  assert.deepStrictEqual(groups.proximo, [near]);
  assert.deepStrictEqual(groups.mas_adelante, [tbd]);
});

test("progressFraction is 0 at film_start, 100 at the anchor date, clamped outside that range", () => {
  assert.strictEqual(progressFraction("2026-10-01", "2026-10-31", new Date("2026-10-01T00:00:00Z")), 0);
  assert.strictEqual(progressFraction("2026-10-01", "2026-10-31", new Date("2026-10-31T00:00:00Z")), 100);
  const mid = progressFraction("2026-10-01", "2026-10-31", new Date("2026-10-16T00:00:00Z"))!;
  assert.ok(mid > 40 && mid < 60);
  assert.strictEqual(progressFraction("2026-10-01", "2026-09-01", new Date()), null); // zero/negative window
  assert.strictEqual(progressFraction(null, "2026-10-31"), null);
});

test("displayCategories drops the seasonal/other meta categories and caps to max", () => {
  assert.deepStrictEqual(displayCategories(["shapewear", "seasonal", "dresses", "other", "shoes"]), ["shapewear", "dresses", "shoes"]);
  assert.deepStrictEqual(displayCategories(["a", "b", "c", "d", "e"], 3), ["a", "b", "c"]);
});

test("eventKind strips the trailing year suffix for stable theme lookups", () => {
  assert.strictEqual(eventKind("halloween_2026"), "halloween");
  assert.strictEqual(eventKind("valentines_2027"), "valentines");
  assert.strictEqual(eventKind("deals_for_you_days_2027"), "deals_for_you_days");
});

test("timelineSpan places a single-month event at the right column", () => {
  // baseYear/baseMonth0 = Oct 2026 (month0 9); an event entirely in Oct
  const ev = event({ film_start: "2026-10-05", film_end: "2026-10-20", event_date: "2026-10-15" });
  const span = timelineSpan(ev, 2026, 9);
  assert.deepStrictEqual(span, { startCol: 1, span: 1, visible: true });
});

test("timelineSpan spans multiple months and clamps to the visible strip", () => {
  // Oct 2026 -> Dec 2026, base = Oct 2026 (col 1), 12-month strip
  const ev = event({ film_start: "2026-10-15", film_end: "2026-12-02", event_date: "2026-11-27" });
  const span = timelineSpan(ev, 2026, 9, 12);
  assert.strictEqual(span.startCol, 1); // Oct
  assert.strictEqual(span.span, 3); // Oct, Nov, Dec
  assert.strictEqual(span.visible, true);
});

test("timelineSpan marks an event entirely outside the strip as not visible", () => {
  const ev = event({ film_start: "2025-01-01", film_end: "2025-01-31", event_date: "2025-01-15" });
  const span = timelineSpan(ev, 2026, 9, 12);
  assert.strictEqual(span.visible, false);
});

test("timelineSpan falls back to event_date/film_end as a single point when there's no film window", () => {
  const ev = event({ event_date: "2026-11-05" });
  const span = timelineSpan(ev, 2026, 9, 12);
  assert.strictEqual(span.visible, true);
  assert.strictEqual(span.startCol, 2); // Nov is base+1
  assert.strictEqual(span.span, 1);
});
