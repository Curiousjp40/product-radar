import { t, type Lang } from "./i18n";

/** Shared detail modal / bottom-sheet overlay (density/redesign pass,
 * 2026-10-16): one reusable overlay per view, hidden until something
 * opens it with HTML content -- same single-reusable-overlay pattern as
 * yaLoTengo.ts's sheet and hideProduct.ts's prompt, rather than a new
 * mechanism per card type. Used by compact product/video cards and the
 * "Lives que venden" cards so tapping a card never expands inline. */
export function detailModalHtml(): string {
  return `
    <div class="detail-modal" hidden>
      <div class="detail-modal-backdrop" data-modal-close></div>
      <div class="detail-modal-sheet" role="dialog" aria-modal="true">
        <button type="button" class="detail-modal-close" data-modal-close aria-label="close">&times;</button>
        <div class="detail-modal-body"></div>
      </div>
    </div>
  `;
}

export function openDetailModal(container: HTMLElement, bodyHtml: string): void {
  const modal = container.querySelector<HTMLElement>(".detail-modal");
  const body = container.querySelector<HTMLElement>(".detail-modal-body");
  if (!modal || !body) return;
  body.innerHTML = bodyHtml;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

export function closeDetailModal(container: HTMLElement): void {
  const modal = container.querySelector<HTMLElement>(".detail-modal");
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = "";
}

export function wireDetailModal(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>("[data-modal-close]").forEach((el) => {
    el.addEventListener("click", () => closeDetailModal(container));
  });
}

export function backToTopButtonHtml(lang: Lang): string {
  return `<button type="button" class="back-to-top-btn" data-back-to-top hidden>&uarr; ${t("back_to_top", lang)}</button>`;
}

export function wireBackToTop(container: HTMLElement, scrollParent: HTMLElement | Window = window): void {
  const btn = container.querySelector<HTMLButtonElement>("[data-back-to-top]");
  if (!btn) return;
  const getScrollY = () => (scrollParent === window ? window.scrollY : (scrollParent as HTMLElement).scrollTop);
  const onScroll = () => {
    btn.hidden = getScrollY() < 400;
  };
  scrollParent.addEventListener("scroll", onScroll);
  onScroll();
  btn.addEventListener("click", () => {
    if (scrollParent === window) window.scrollTo({ top: 0, behavior: "smooth" });
    else (scrollParent as HTMLElement).scrollTo({ top: 0, behavior: "smooth" });
  });
}
