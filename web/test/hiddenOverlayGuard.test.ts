import assert from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** Regression test for a real bug (2026-10-16): .detail-modal set
 * `display: flex` with no `.detail-modal[hidden] { display: none }`
 * override, so the native `hidden` attribute was silently beaten by that
 * author rule -- the modal showed as an empty overlay on every page load,
 * before any card was ever tapped. Every overlay/sheet element that is
 * rendered with the bare `hidden` attribute and also has its own
 * `display` set must have a matching `[hidden] { display: none }` rule. */
const CSS = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

const OVERLAY_CLASSES_RENDERED_HIDDEN = ["detail-modal", "ya-lo-tengo-sheet", "back-to-top-btn"];

test("every overlay class rendered with the bare hidden attribute has an explicit [hidden] display:none rule, or sets no conflicting display", () => {
  for (const cls of OVERLAY_CLASSES_RENDERED_HIDDEN) {
    const baseRuleMatch = CSS.match(new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`));
    const setsDisplay = baseRuleMatch ? /display\s*:/.test(baseRuleMatch[0]) : false;
    if (!setsDisplay) continue; // no conflicting display -- the UA [hidden] default still applies
    const hiddenRule = new RegExp(`\\.${cls}\\[hidden\\]\\s*\\{[^}]*display\\s*:\\s*none`);
    assert.ok(hiddenRule.test(CSS), `.${cls} sets its own display but has no .${cls}[hidden] { display: none } override`);
  }
});
