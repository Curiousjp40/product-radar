import assert from "node:assert";
import { test } from "node:test";
import { scanCopyForLeaks } from "../src/copyScan.ts";
import { dict } from "../src/i18n.ts";

test("scanCopyForLeaks flags a raw snake_case key", () => {
  const issues = scanCopyForLeaks(["Categoría: beauty_hair"]);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].reason, "raw_key");
});

test("scanCopyForLeaks flags a bare ISO date", () => {
  const issues = scanCopyForLeaks(["Empieza a grabar: 2026-11-01"]);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].reason, "iso_date");
});

test("scanCopyForLeaks leaves normal Spanish/English copy alone", () => {
  assert.deepStrictEqual(scanCopyForLeaks(["Vas al ritmo de $120", "25 oct", "8-10 PM"]), []);
});

test("every ES and EN string in the i18n dict is free of raw keys and ISO dates", () => {
  const strings = Object.values(dict).flatMap((entry) => [entry.es, entry.en]);
  const issues = scanCopyForLeaks(strings);
  assert.deepStrictEqual(issues, [], `found raw key / ISO date leaks in i18n.ts: ${JSON.stringify(issues)}`);
});
