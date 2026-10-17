import assert from "node:assert";
import { test } from "node:test";
import { aggregateTopLiveProducts } from "../src/liveProductAggregate.ts";

test("aggregateTopLiveProducts sums units and counts distinct lives", () => {
  const live1 = [{ product_id: "a", title: "A", image_url: null, price: 10, units_sold: 5 }];
  const live2 = [
    { product_id: "a", title: "A", image_url: null, price: 8, units_sold: 3 },
    { product_id: "b", title: "B", image_url: null, price: 20, units_sold: 1 },
  ];
  const result = aggregateTopLiveProducts([live1, live2]);
  const a = result.find((r) => r.product_id === "a")!;
  assert.strictEqual(a.total_units_sold, 8);
  assert.strictEqual(a.live_count, 2);
  assert.strictEqual(a.best_price, 8);
});

test("aggregateTopLiveProducts sorts by total units sold descending and respects limit", () => {
  const livesProducts = [
    [{ product_id: "low", title: "Low", image_url: null, price: 5, units_sold: 1 }],
    [{ product_id: "high", title: "High", image_url: null, price: 5, units_sold: 100 }],
  ];
  const result = aggregateTopLiveProducts(livesProducts, 1);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].product_id, "high");
});

test("aggregateTopLiveProducts ignores a zero price when finding the best price", () => {
  const livesProducts = [
    [{ product_id: "a", title: "A", image_url: null, price: 0, units_sold: 1 }],
    [{ product_id: "a", title: "A", image_url: null, price: 12, units_sold: 1 }],
  ];
  const result = aggregateTopLiveProducts(livesProducts);
  assert.strictEqual(result[0].best_price, 12);
});
