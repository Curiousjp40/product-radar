// Design review section 1 "OverflowMenu" component / item 0.6 ("max 2
// visible actions per card; the rest go in a ⋯ menu"). One shared
// implementation: a small button that toggles a dropdown of the items
// passed to it. Each card instance gets its own menu (keyed by a unique
// id so multiple menus on one page don't collide), closed by default,
// closes on an outside click or picking an item.
import { t, type Lang } from "./i18n";

export interface OverflowMenuItem {
  html: string; // a full <button>/<a> element's outerHTML, incl. data-action etc.
}

export function overflowMenuHtml(menuId: string, items: OverflowMenuItem[], lang: Lang): string {
  if (items.length === 0) return "";
  return `
    <div class="overflow-menu" data-overflow-menu="${menuId}">
      <button type="button" class="overflow-menu-trigger" data-overflow-trigger="${menuId}" aria-label="${t("overflow_menu_label", lang)}" aria-expanded="false">&#8942;</button>
      <div class="overflow-menu-list" data-overflow-list="${menuId}" hidden>
        ${items.map((i) => i.html).join("")}
      </div>
    </div>
  `;
}

/** Wires every overflow menu inside `container` (toggle + outside-click +
 * item-click to close). Safe to call on every re-render -- uses a
 * container-level delegated listener guarded the same way wireYaLoTengo
 * guards its own (WeakSet), so re-wiring an already-wired container is a
 * no-op rather than double-binding. */
const wiredContainers = new WeakSet<HTMLElement>();

export function wireOverflowMenus(container: HTMLElement): void {
  if (wiredContainers.has(container)) return;
  wiredContainers.add(container);

  container.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const trigger = target.closest<HTMLElement>("[data-overflow-trigger]");
    if (trigger) {
      e.stopPropagation();
      const id = trigger.dataset.overflowTrigger!;
      const list = container.querySelector<HTMLElement>(`[data-overflow-list="${id}"]`);
      if (!list) return;
      const willOpen = list.hidden;
      // Close every other open menu in this container first.
      container.querySelectorAll<HTMLElement>("[data-overflow-list]").forEach((l) => {
        l.hidden = true;
      });
      container.querySelectorAll<HTMLElement>("[data-overflow-trigger]").forEach((t) => t.setAttribute("aria-expanded", "false"));
      list.hidden = !willOpen;
      trigger.setAttribute("aria-expanded", String(willOpen));
      return;
    }
    // Any other click (inside a menu list or anywhere else) closes all open menus.
    if (!target.closest("[data-overflow-list]")) {
      container.querySelectorAll<HTMLElement>("[data-overflow-list]").forEach((l) => {
        l.hidden = true;
      });
      container.querySelectorAll<HTMLElement>("[data-overflow-trigger]").forEach((t) => t.setAttribute("aria-expanded", "false"));
    } else {
      // Clicking an actual item inside the list: close after the click's
      // own handler (attached elsewhere) has had a chance to run.
      setTimeout(() => {
        container.querySelectorAll<HTMLElement>("[data-overflow-list]").forEach((l) => {
          l.hidden = true;
        });
      }, 0);
    }
  });
}
