import assert from "node:assert";
import { test } from "node:test";
import { liveProductsMatchTrackedCategories } from "../src/liveProductCategoryMatch.ts";

test("matches when a product title contains a tracked-category keyword", () => {
  assert.strictEqual(liveProductsMatchTrackedCategories([{ title: "Women's Floral Maxi Dress" }]), true);
  assert.strictEqual(liveProductsMatchTrackedCategories([{ title: "Cozy Pet Bed for Small Dogs" }]), true);
});

test("real example: dog treats do not match pet_furniture or any tracked category", () => {
  assert.strictEqual(liveProductsMatchTrackedCategories([{ title: "Natural Chicken Jerky Dog Treats 16oz" }]), false);
});

test("real bug: 'Chicken-Coated' must not substring-match the 'coat' keyword", () => {
  assert.strictEqual(
    liveProductsMatchTrackedCategories([
      { title: "4-6 Peanut Butter Collagen Cheek Rolls (5 Pack)" },
      { title: "USA Lamb Tripe Dog Chews" },
      { title: "9-12 Chicken-Coated Collagen Cheek Rolls" },
      { title: "12-inch CollaBully Sticks" },
      { title: "Wild Wolf 12 Beef Colly Sticks" },
    ]),
    false,
  );
});

test("returns false for an empty product list", () => {
  assert.strictEqual(liveProductsMatchTrackedCategories([]), false);
});

test("matches when at least one of several products is on-category", () => {
  assert.strictEqual(
    liveProductsMatchTrackedCategories([{ title: "Dog Treats" }, { title: "Cat Toy" }, { title: "Leather Ankle Boots" }]),
    true,
  );
});
