/** Ryan's request: "filter out lives whose products don't match her
 * categories by the products themselves" -- a live's assigned category
 * (from the free highlights feed) can be wrong at the product level, e.g.
 * @gusthepup0 tagged "pet_furniture" actually sells dog treats, not pet
 * furniture. live_products.json has no per-product category field, so this
 * is a lightweight keyword check against her 12 tracked categories' real
 * products -- not a precise classifier, but enough to catch an
 * obviously-off-topic live. Hides (filters from the UI list), never
 * deletes the underlying data. */

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  shapewear: ["shapewear", "faja", "waist trainer", "body shaper", "shaper short", "tummy control"],
  dresses: ["dress", "vestido", "gown"],
  sets: ["set", "jumpsuit", "romper", "two piece", "2 piece", "conjunto"],
  furniture: ["sofa", "couch", "table", "chair", "desk", "bed frame", "wardrobe", "dresser", "nightstand", "bookshelf", "cabinet", "ottoman", "bench"],
  home_decor: ["decor", "lamp", "rug", "mirror", "vase", "pillow", "curtain", "frame", "candle", "wall art", "shelf", "plant", "clock", "throw blanket", "tapestry"],
  winter_clothing: ["jacket", "sweater", "coat", "hoodie", "cardigan", "sweatshirt"],
  shoes: ["shoe", "boot", "sandal", "sneaker", "clog", "heel", "flat", "slipper"],
  pet_furniture: ["pet bed", "dog bed", "cat bed", "pet crate", "pet kennel", "pet house", "cat tree", "pet carrier"],
  home_storage: ["storage", "organizer", "bin", "rack", "basket", "closet", "drawer divider", "shelving"],
  costumes: ["costume", "disfraz", "halloween"],
  pajamas: ["pajama", "pjs", "sleepwear", "nightgown"],
  activewear: ["legging", "sports bra", "yoga", "activewear", "gym short", "workout"],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when at least one product's title matches a keyword for ANY of
 * her tracked categories (not necessarily the live's own assigned
 * category) -- a loose "is this relevant at all" check, not a strict
 * per-category classifier. Word-boundary matched, not substring -- a
 * plain `.includes("coat")` false-positives on "Chicken-Coated Collagen
 * Cheek Rolls" (a real dog-treats example this filter is meant to catch),
 * same substring pitfall already documented in
 * config/categories.yaml's exclude_title_keywords. */
// "s?" handles the common plural case ("Boots", "Dresses" -> "Dress" +
// "es" doesn't match cleanly, but most of these nouns just take a plain
// "s"); still word-bounded so "coated" never matches "coat".
const KEYWORD_PATTERNS = Object.values(CATEGORY_KEYWORDS)
  .flat()
  .map((kw) => new RegExp(`\\b${escapeRegExp(kw)}s?\\b`, "i"));

export function liveProductsMatchTrackedCategories(products: { title: string }[]): boolean {
  if (products.length === 0) return false;
  return products.some((p) => KEYWORD_PATTERNS.some((re) => re.test(p.title)));
}
