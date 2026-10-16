// Sync gap #3 (2026-10-16): a small header badge so Roxie can tell at a
// glance whether this device/browser is linked to sync (password stored)
// or still local-only -- tapping it when local-only prompts for the
// password and pushes this device's existing data up right away.
import { t, type Lang } from "./i18n";
import { isSyncLinked, linkDeviceForSync } from "./syncedStorage";

export function syncIndicatorHtml(lang: Lang): string {
  const linked = isSyncLinked();
  return `
    <button type="button" class="sync-indicator ${linked ? "synced" : "local-only"}" data-action="sync-indicator" ${linked ? "disabled" : ""}>
      ${linked ? t("sync_status_synced", lang) : t("sync_status_local_only", lang)}
    </button>
  `;
}

/** Wires every `.sync-indicator` in `container` (there should be exactly
 * one, in the header). `onLinked` fires after a successful link so the
 * caller can re-render the indicator (and anything else gated on sync
 * state). */
export function wireSyncIndicator(container: HTMLElement, onLinked: () => void): void {
  container.querySelectorAll<HTMLButtonElement>('[data-action="sync-indicator"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      void linkDeviceForSync().then((linked) => {
        if (linked) onLinked();
      });
    });
  });
}
