import assert from "node:assert";
import { test } from "node:test";
import { detectLayout } from "../src/layoutDetect.ts";

test("detectLayout: below 768px is always mobile", () => {
  assert.strictEqual(detectLayout(375, false), "mobile");
  assert.strictEqual(detectLayout(767, false), "mobile");
});

test("detectLayout: a touch-primary (coarse pointer) device is mobile regardless of width", () => {
  assert.strictEqual(detectLayout(1440, true), "mobile");
});

test("detectLayout: >=1024px with a fine pointer is desktop", () => {
  assert.strictEqual(detectLayout(1024, false), "desktop");
  assert.strictEqual(detectLayout(1440, false), "desktop");
});

test("detectLayout: the 768-1023 tablet band gets the mobile layout", () => {
  assert.strictEqual(detectLayout(768, false), "mobile");
  assert.strictEqual(detectLayout(1023, false), "mobile");
});

test("detectLayout: an explicit override always wins over detection", () => {
  assert.strictEqual(detectLayout(1440, false, "mobile"), "mobile");
  assert.strictEqual(detectLayout(375, true, "desktop"), "desktop");
});

test("detectLayout: 'auto' override falls back to normal detection", () => {
  assert.strictEqual(detectLayout(1440, false, "auto"), "desktop");
});
