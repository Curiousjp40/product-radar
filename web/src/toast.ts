// Part A.3 (2026-10-16): a ~5s "Undo" toast after marking a product
// not-for-me or owned, so a mis-tap isn't permanent. One shared host
// element reused across views (appended to <body> lazily).
import { t, type Lang } from "./i18n";

let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function host(): HTMLElement {
  let el = document.getElementById("undo-toast-host");
  if (!el) {
    el = document.createElement("div");
    el.id = "undo-toast-host";
    document.body.appendChild(el);
  }
  return el;
}

export function showUndoToast(lang: Lang, message: string, onUndo: () => void): void {
  const el = host();
  if (dismissTimer) clearTimeout(dismissTimer);
  el.innerHTML = `
    <div class="undo-toast">
      <span>${message}</span>
      <button type="button" class="undo-toast-btn">${t("undo_button", lang)}</button>
    </div>
  `;
  el.querySelector<HTMLButtonElement>(".undo-toast-btn")?.addEventListener("click", () => {
    if (dismissTimer) clearTimeout(dismissTimer);
    el.innerHTML = "";
    onUndo();
  });
  dismissTimer = setTimeout(() => {
    el.innerHTML = "";
  }, 5000);
}
