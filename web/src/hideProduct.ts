import { t, type Lang } from "./i18n";
import { hideCategory } from "./pipeline";

/** Part C4 "No me interesa": once a view has just hidden a product, it
 * calls countHiddenInCategory to see if this was the 3rd+ hide in that
 * category (and the category isn't already hidden), and if so renders
 * categoryHidePromptHtml and wires it with wireCategoryHidePrompt. Shared
 * across hoy/thisWeek/todos/product so the threshold and prompt UI stay
 * consistent everywhere the button appears. */

export function countHiddenInCategory(
  feedback: Record<string, string>,
  categoryByProductId: Map<string, string>,
  category: string,
): number {
  let n = 0;
  for (const [productId, signal] of Object.entries(feedback)) {
    if (signal === "not_for_me" && categoryByProductId.get(productId) === category) n++;
  }
  return n;
}

export function categoryHidePromptHtml(category: string, categoryLabel: string, lang: Lang): string {
  return `
    <div class="category-hide-prompt" data-category="${category}">
      <p>${t("hide_category_prompt", lang, { category: categoryLabel })}</p>
      <div class="category-hide-actions">
        <button type="button" class="btn-primary" data-action="hide-category-yes">${t("hide_category_yes", lang)}</button>
        <button type="button" class="btn-save-pill" data-action="hide-category-no">${t("hide_category_no", lang)}</button>
      </div>
    </div>
  `;
}

export function wireCategoryHidePrompt(container: HTMLElement, rerender: () => void): void {
  const prompt = container.querySelector<HTMLElement>(".category-hide-prompt");
  if (!prompt) return;
  const category = prompt.dataset.category!;
  prompt.querySelector('[data-action="hide-category-yes"]')?.addEventListener("click", () => {
    hideCategory(category);
    rerender();
  });
  prompt.querySelector('[data-action="hide-category-no"]')?.addEventListener("click", () => {
    prompt.remove();
  });
}
