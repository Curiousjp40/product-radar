import assert from "node:assert";
import { test } from "node:test";
import { groupSeasonEvents } from "../src/seasonLogic.ts";
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

test("groupSeasonEvents drops events whose film window already ended", () => {
  const ev = event({ id: "past", film_start: "2026-01-01", film_end: "2026-01-31" });
  const groups = groupSeasonEvents([ev], TODAY);
  assert.deepStrictEqual(groups.ahora, []);
  assert.deepStrictEqual(groups.proximo, []);
  assert.deepStrictEqual(groups.mas_adelante, []);
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
