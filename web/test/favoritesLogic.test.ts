import assert from "node:assert";
import { test } from "node:test";
import { applyFavoritesBoost, emptyFavorites, hasAnyFavorites, matchesFavorites, type Favorites } from "../src/favoritesLogic.ts";

test("hasAnyFavorites is false for an empty Favorites, true once something is set", () => {
  assert.strictEqual(hasAnyFavorites(emptyFavorites()), false);
  assert.strictEqual(hasAnyFavorites({ ...emptyFavorites(), categories: ["dresses"] }), true);
  assert.strictEqual(hasAnyFavorites({ ...emptyFavorites(), brands: ["YeeZaa"] }), true);
});

test("matchesFavorites matches by favorited category", () => {
  const fav: Favorites = { ...emptyFavorites(), categories: ["dresses"] };
  assert.strictEqual(matchesFavorites({ category: "dresses", shop_name: "Anything", price: 20 }, fav), true);
  assert.strictEqual(matchesFavorites({ category: "shoes", shop_name: "Anything", price: 20 }, fav), false);
});

test("matchesFavorites matches by favorited brand, case-insensitively", () => {
  const fav: Favorites = { ...emptyFavorites(), brands: ["YeeZaa"] };
  assert.strictEqual(matchesFavorites({ category: "dresses", shop_name: "yeezaa", price: 20 }, fav), true);
  assert.strictEqual(matchesFavorites({ category: "dresses", shop_name: "Other Shop", price: 20 }, fav), false);
});

test("matchesFavorites excludes a match outside the optional price range", () => {
  const fav: Favorites = { ...emptyFavorites(), categories: ["dresses"], price_min: 20, price_max: 50 };
  assert.strictEqual(matchesFavorites({ category: "dresses", shop_name: "x", price: 30 }, fav), true);
  assert.strictEqual(matchesFavorites({ category: "dresses", shop_name: "x", price: 10 }, fav), false);
  assert.strictEqual(matchesFavorites({ category: "dresses", shop_name: "x", price: 90 }, fav), false);
});

test("matchesFavorites returns false when nothing is favorited yet, regardless of price range", () => {
  assert.strictEqual(matchesFavorites({ category: "dresses", shop_name: "x", price: 30 }, emptyFavorites()), false);
});

test("applyFavoritesBoost adds the boost only for a favorite", () => {
  assert.strictEqual(applyFavoritesBoost(0.5, true), 0.65);
  assert.strictEqual(applyFavoritesBoost(0.5, false), 0.5);
});

test("applyFavoritesBoost accepts a custom boost amount", () => {
  assert.strictEqual(applyFavoritesBoost(0.5, true, 0.3), 0.8);
});
