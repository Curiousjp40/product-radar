import { loadCandidates } from "../api";
import { assetUrl } from "../asset";
import { t, type Lang } from "../i18n";
import { clearFeedback, getAllFeedback, getHiddenCategories, unhideCategory } from "../pipeline";

export async function renderOcultos(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const [{ data }, feedback] = await Promise.all([loadCandidates(), getAllFeedback()]);
  const hiddenCategories = getHiddenCategories();
  const byId = new Map(data.candidates.map((c) => [c.product_id, c]));
  const hiddenProductIds = Object.keys(feedback).filter((id) => feedback[id] === "not_for_me");

  const draw = () => {
    const hasAny = hiddenCategories.length > 0 || hiddenProductIds.length > 0;
    container.innerHTML = `
      <h2 class="view-title">${t("ocultos_title", lang)}</h2>
      ${!hasAny ? `<p class="empty-state">${t("ocultos_empty", lang)}</p>` : ""}
      ${
        hiddenCategories.length > 0
          ? `<div class="ocultos-section">
              <h3>${t("ocultos_hidden_categories_title", lang)}</h3>
              ${hiddenCategories
                .map((cat) => {
                  const sample = data.candidates.find((c) => c.category === cat);
                  const label = sample ? (lang === "es" ? sample.category_label_es : sample.category_label_en) : cat;
                  return `
                    <div class="ocultos-row">
                      <div class="name">${label}</div>
                      <button type="button" class="btn-save-pill" data-action="unhide-category" data-category="${cat}">${t("undo_button", lang)}</button>
                    </div>`;
                })
                .join("")}
            </div>`
          : ""
      }
      ${
        hiddenProductIds.length > 0
          ? `<div class="ocultos-section">
              <h3>${t("ocultos_hidden_products_title", lang)}</h3>
              ${hiddenProductIds
                .map((id) => {
                  const c = byId.get(id);
                  if (!c) return "";
                  const photo = c.image_url ? `<img class="photo" src="${assetUrl(c.image_url)}" alt="" loading="lazy" />` : `<div class="photo"></div>`;
                  return `
                    <div class="ocultos-row">
                      ${photo}
                      <div class="name">${c.clean_title}</div>
                      <button type="button" class="btn-save-pill" data-action="unhide-product" data-product-id="${id}">${t("undo_button", lang)}</button>
                    </div>`;
                })
                .join("")}
            </div>`
          : ""
      }
    `;

    container.querySelectorAll<HTMLButtonElement>('[data-action="unhide-category"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        unhideCategory(btn.dataset.category!);
        const idx = hiddenCategories.indexOf(btn.dataset.category!);
        if (idx >= 0) hiddenCategories.splice(idx, 1);
        draw();
      });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-action="unhide-product"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const productId = btn.dataset.productId!;
        await clearFeedback(productId);
        const idx = hiddenProductIds.indexOf(productId);
        if (idx >= 0) hiddenProductIds.splice(idx, 1);
        draw();
      });
    });
  };

  draw();
}
