import assert from "node:assert/strict";
import { test } from "node:test";

import { approvalRate, daysWaiting, shopRejectionCount } from "../src/misProductosLogic.ts";

function item(overrides: Partial<{ status: string; date_requested: string; shop_name: string | null; times_rejected: number }> = {}) {
  return { status: "solicitado", date_requested: "2026-10-16", shop_name: null, times_rejected: 0, ...overrides };
}

test("daysWaiting counts whole days since date_requested", () => {
  const it = item({ date_requested: "2026-10-01" });
  assert.equal(daysWaiting(it, new Date("2026-10-08T00:00:00Z")), 7);
  assert.equal(daysWaiting(it, new Date("2026-10-01T00:00:00Z")), 0);
});

test("shopRejectionCount sums times_rejected across a shop's items, not current status", () => {
  const items = [
    item({ shop_name: "ShopA", times_rejected: 1, status: "solicitado" }),
    item({ shop_name: "ShopA", times_rejected: 2, status: "rechazado" }),
    item({ shop_name: "ShopB", times_rejected: 5, status: "rechazado" }),
  ];
  assert.equal(shopRejectionCount(items, "ShopA"), 3);
  assert.equal(shopRejectionCount(items, "ShopB"), 5);
  assert.equal(shopRejectionCount(items, "ShopC"), 0);
});

test("approvalRate is null with no resolved requests", () => {
  assert.equal(approvalRate([item({ status: "solicitado" })]), null);
});

test("approvalRate counts approved vs rejected among resolved requests only", () => {
  const items = [
    item({ status: "solicitado" }), // still pending, excluded
    item({ status: "aprobado" }),
    item({ status: "recibido" }),
    item({ status: "rechazado" }),
  ];
  // 2 approved-ish (aprobado, recibido) out of 3 resolved (aprobado, recibido, rechazado)
  assert.equal(approvalRate(items), 2 / 3);
});
