import assert from "node:assert";
import { test } from "node:test";
import { earningsPerHour } from "../src/effortPay.ts";

test("earningsPerHour divides earnings by hours of effort", () => {
  assert.strictEqual(earningsPerHour(15, 30), 30); // 15 / 0.5h
  assert.strictEqual(earningsPerHour(10, 60), 10); // 10 / 1h
});

test("earningsPerHour is null when effort_minutes is missing or zero", () => {
  assert.strictEqual(earningsPerHour(10, null), null);
  assert.strictEqual(earningsPerHour(10, 0), null);
  assert.strictEqual(earningsPerHour(10, -5), null);
});
