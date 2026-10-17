import type { Lang } from "./i18n";

/** Design review section 0 item 7: never show a raw category key
 * (`beauty_hair`, `seasonal`, ...) in the UI. Mirrors config/categories.yaml's
 * label_es/label_en for every key, so a category with no current candidate
 * sample (the case that was leaking the raw key) still gets a real label. */
const CATEGORY_LABELS: Record<string, { es: string; en: string }> = {
  shapewear: { es: "Fajas", en: "Shapewear" },
  dresses: { es: "Vestidos", en: "Dresses" },
  sets: { es: "Conjuntos", en: "Sets" },
  furniture: { es: "Muebles", en: "Furniture" },
  home_decor: { es: "Decoración", en: "Home Decor" },
  winter_clothing: { es: "Ropa de invierno", en: "Winter Clothing" },
  shoes: { es: "Zapatos", en: "Shoes" },
  pet_furniture: { es: "Mascotas", en: "Pet Furniture" },
  home_storage: { es: "Organización", en: "Home Storage" },
  costumes: { es: "Disfraces", en: "Costumes" },
  pajamas: { es: "Pijamas", en: "Pajamas" },
  activewear: { es: "Fitness", en: "Activewear" },
  seasonal: { es: "Temporada", en: "Seasonal" },
  other: { es: "Otro", en: "Other" },
  beauty_hair: { es: "Belleza y cabello", en: "Beauty & hair" },
  womens_clothing: { es: "Ropa de mujer", en: "Women's Clothing" },
};

/** Resolve a category key to a clean label. Prefers a label already carried
 * on the data (`fromData`, e.g. a candidate's category_label_es/en) since
 * that's the freshest source; falls back to the static map above; only
 * falls back to the raw key as an absolute last resort for an unmapped key,
 * so a missing mapping fails loud (visible raw key) rather than silently. */
export function categoryLabel(key: string, lang: Lang, fromData?: string | null): string {
  if (fromData) return fromData;
  const entry = CATEGORY_LABELS[key];
  if (entry) return lang === "es" ? entry.es : entry.en;
  return key;
}
