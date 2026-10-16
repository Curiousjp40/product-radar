import { addMisProducto, emptyMisProducto } from "./misProductos";
import { t, type Lang } from "./i18n";

/** Part 3 "Ya lo tengo" button (2026-10-16): one tap on any product card
 * or the product page opens this small sheet, then adds the product to
 * Mis Productos with status "recibido" -- the existing +Venta/units/
 * earnings/video-link tracking on that record applies from there on, no
 * separate data model needed. */
export interface YaLoTengoProduct {
  product_id: string;
  name: string;
  photo_url: string | null;
  category: string | null;
  commission_pct: number | null;
  tiktok_shop_url: string | null;
  price: number | null;
  earnings_per_sale: number | null;
  effort_minutes: number | null;
  shop_name: string | null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function yaLoTengoButtonHtml(productId: string, lang: Lang): string {
  return `<button type="button" class="btn-ya-lo-tengo" data-action="ya-lo-tengo" data-product-id="${productId}">${t("ya_lo_tengo_button", lang)}</button>`;
}

/** One shared sheet per view, hidden until a "Ya lo tengo" button opens it
 * for a specific product_id (tracked via `data-active-product-id` on the
 * sheet itself, not a JS closure variable -- see wireYaLoTengo's comment
 * for why). Same single-reusable-overlay pattern as hideProduct.ts's
 * categoryHidePromptHtml. */
export function yaLoTengoSheetHtml(lang: Lang): string {
  return `
    <div class="ya-lo-tengo-sheet" hidden>
      <div class="ya-lo-tengo-sheet-inner">
        <h4>${t("ya_lo_tengo_sheet_title", lang)}</h4>
        <div class="ya-lo-tengo-source-choice">
          <button type="button" class="ya-lo-tengo-source-btn active" data-source="muestra">${t("ya_lo_tengo_source_muestra", lang)}</button>
          <button type="button" class="ya-lo-tengo-source-btn" data-source="comprado">${t("ya_lo_tengo_source_comprado", lang)}</button>
        </div>
        <label class="ya-lo-tengo-field">
          <span>${t("ya_lo_tengo_date_label", lang)}</span>
          <input type="date" class="ya-lo-tengo-date" value="${todayIso()}" max="${todayIso()}" />
        </label>
        <label class="ya-lo-tengo-field">
          <span>${t("ya_lo_tengo_note_label", lang)}</span>
          <textarea class="ya-lo-tengo-note" rows="2"></textarea>
        </label>
        <div class="ya-lo-tengo-sheet-actions">
          <button type="button" class="btn-save-pill ya-lo-tengo-cancel">${t("cancel_button", lang)}</button>
          <button type="button" class="btn-primary ya-lo-tengo-confirm">${t("ya_lo_tengo_confirm_button", lang)}</button>
        </div>
      </div>
    </div>
  `;
}

// A view may call wireYaLoTengo many times on the SAME `container` node
// across re-renders (e.g. thisWeek.ts re-wires on every renderThisWeek),
// while the sheet/button DOM underneath it is replaced each time and
// `productsById`/`onSaved` change (new picks, new swap, new filter).
// Per-interaction state (which product the sheet is open for, which
// source is selected) lives on the DOM itself (the sheet's
// `data-active-product-id`/`data-source`, the source buttons' "active"
// class), not in a JS closure, so it survives being re-wired. The
// container-level click listener is attached only once (guarded by
// `perContainer`), but reads `productsById`/`onSaved` through this map on
// every click -- updated on every call -- so it always sees the latest.
const perContainer = new WeakMap<
  HTMLElement,
  { products: Map<string, YaLoTengoProduct>; onSaved: (productId: string) => void; lang: Lang }
>();

/** Wires every `[data-action="ya-lo-tengo"]` button in `container` to the
 * one `.ya-lo-tengo-sheet` also in `container` (from yaLoTengoSheetHtml
 * above). `onSaved` fires after the Mis Productos record is written, so
 * the caller can re-render (swap the product out of Hoy/Esta semana). */
export function wireYaLoTengo(
  container: HTMLElement,
  lang: Lang,
  productsById: Map<string, YaLoTengoProduct>,
  onSaved: (productId: string) => void,
): void {
  const alreadyWired = perContainer.has(container);
  perContainer.set(container, { products: productsById, onSaved, lang });
  if (alreadyWired) return;

  container.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const sheet = container.querySelector<HTMLElement>(".ya-lo-tengo-sheet");
    if (!sheet) return;
    const state = perContainer.get(container);
    if (!state) return;

    const openBtn = target.closest<HTMLButtonElement>('[data-action="ya-lo-tengo"]');
    if (openBtn && container.contains(openBtn)) {
      sheet.dataset.activeProductId = openBtn.dataset.productId ?? "";
      sheet.dataset.source = "muestra";
      sheet
        .querySelectorAll<HTMLButtonElement>(".ya-lo-tengo-source-btn")
        .forEach((b) => b.classList.toggle("active", b.dataset.source === "muestra"));
      const dateInput = sheet.querySelector<HTMLInputElement>(".ya-lo-tengo-date");
      if (dateInput) dateInput.value = todayIso();
      const noteInput = sheet.querySelector<HTMLTextAreaElement>(".ya-lo-tengo-note");
      if (noteInput) noteInput.value = "";
      sheet.hidden = false;
      return;
    }

    const sourceBtn = target.closest<HTMLButtonElement>(".ya-lo-tengo-source-btn");
    if (sourceBtn && sheet.contains(sourceBtn)) {
      sheet.dataset.source = sourceBtn.dataset.source ?? "muestra";
      sheet
        .querySelectorAll<HTMLButtonElement>(".ya-lo-tengo-source-btn")
        .forEach((b) => b.classList.toggle("active", b === sourceBtn));
      return;
    }

    if (target.closest(".ya-lo-tengo-cancel")) {
      sheet.hidden = true;
      delete sheet.dataset.activeProductId;
      return;
    }

    if (target.closest(".ya-lo-tengo-confirm")) {
      const productId = sheet.dataset.activeProductId;
      if (!productId) return;
      const product = state.products.get(productId);
      if (!product) return;
      const dateInput = sheet.querySelector<HTMLInputElement>(".ya-lo-tengo-date");
      const noteInput = sheet.querySelector<HTMLTextAreaElement>(".ya-lo-tengo-note");
      const dateReceived = dateInput?.value || todayIso();
      const source = sheet.dataset.source === "comprado" ? "comprado" : "muestra";
      const sourceLabel = t(source === "muestra" ? "ya_lo_tengo_source_muestra" : "ya_lo_tengo_source_comprado", state.lang);
      const note = noteInput?.value.trim() ?? "";
      void addMisProducto(
        emptyMisProducto({
          product_id: product.product_id,
          name: product.name,
          photo_url: product.photo_url,
          category: product.category,
          commission_pct: product.commission_pct,
          tiktok_shop_url: product.tiktok_shop_url,
          shop_name: product.shop_name,
          status: "recibido",
          date_received: dateReceived,
          notes: note ? `${sourceLabel}: ${note}` : sourceLabel,
          price: product.price,
          earnings_per_sale: product.earnings_per_sale,
          effort_minutes: product.effort_minutes,
        }),
      ).then(() => {
        sheet.hidden = true;
        delete sheet.dataset.activeProductId;
        state.onSaved(productId);
      });
    }
  });
}
