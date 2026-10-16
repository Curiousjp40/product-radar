import assert from "node:assert/strict";
import { test } from "node:test";

import { applyOwnedDisplay } from "../src/ownedListOrdering.ts";

function item(id: string) {
  return { id };
}

test("applyOwnedDisplay hides owned items when hideOwned is true", () => {
  const items = [item("a"), item("b"), item("c")];
  const result = applyOwnedDisplay(items, new Set(["b"]), (i) => i.id, true);
  assert.deepEqual(result.map((i) => i.id), ["a", "c"]);
});

test("applyOwnedDisplay moves owned items to the bottom when hideOwned is false", () => {
  const items = [item("a"), item("b"), item("c")];
  const result = applyOwnedDisplay(items, new Set(["a"]), (i) => i.id, false);
  assert.deepEqual(result.map((i) => i.id), ["b", "c", "a"]);
});

test("applyOwnedDisplay preserves relative order within each group", () => {
  const items = [item("a"), item("b"), item("c"), item("d")];
  const result = applyOwnedDisplay(items, new Set(["a", "c"]), (i) => i.id, false);
  assert.deepEqual(result.map((i) => i.id), ["b", "d", "a", "c"]);
});

test("applyOwnedDisplay is a no-op when nothing is owned", () => {
  const items = [item("a"), item("b")];
  assert.deepEqual(applyOwnedDisplay(items, new Set(), (i) => i.id, true).map((i) => i.id), ["a", "b"]);
  assert.deepEqual(applyOwnedDisplay(items, new Set(), (i) => i.id, false).map((i) => i.id), ["a", "b"]);
});
