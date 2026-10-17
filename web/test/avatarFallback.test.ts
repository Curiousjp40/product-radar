import assert from "node:assert";
import { test } from "node:test";
import { colorForHandle, initialsCircleDataUri, initialsFromHandle } from "../src/avatarFallback.ts";

test("initialsFromHandle strips @ and uppercases the first two letters", () => {
  assert.strictEqual(initialsFromHandle("@oye_sebita"), "OY");
  assert.strictEqual(initialsFromHandle("roxm___"), "RO");
});

test("initialsFromHandle falls back to ? for an empty handle", () => {
  assert.strictEqual(initialsFromHandle(""), "?");
});

test("colorForHandle is deterministic for the same handle", () => {
  assert.strictEqual(colorForHandle("oye_sebita"), colorForHandle("oye_sebita"));
});

test("initialsCircleDataUri returns an svg data uri containing the initials", () => {
  const uri = initialsCircleDataUri("oye_sebita", 64);
  assert.ok(uri.startsWith("data:image/svg+xml;utf8,"));
  assert.ok(decodeURIComponent(uri).includes("OY"));
});
