// Design review section 1b: desktop/mobile auto-detect, with a manual
// override. Pure function (width, pointer, override) -> layout so it's
// directly unit-testable without a DOM/matchMedia mock.
export type Layout = "mobile" | "desktop";
export type LayoutOverride = "auto" | "mobile" | "desktop";

/** Phone layout below 768px OR on a touch-primary device (coarse
 * pointer); desktop layout at >=1024px with a fine pointer; the 768-1023
 * "tablet" band gets the phone layout (2-3 grid columns there come from
 * the existing CSS breakpoints, not this class). An explicit override
 * always wins over detection. */
export function detectLayout(width: number, pointerIsCoarse: boolean, override: LayoutOverride = "auto"): Layout {
  if (override === "mobile" || override === "desktop") return override;
  if (width < 768 || pointerIsCoarse) return "mobile";
  if (width >= 1024) return "desktop";
  return "mobile"; // tablet band
}

const STORAGE_KEY = "product-radar:layout-override";

export function getLayoutOverride(): LayoutOverride {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "mobile" || raw === "desktop" ? raw : "auto";
  } catch {
    return "auto";
  }
}

export function setLayoutOverride(value: LayoutOverride): void {
  try {
    if (value === "auto") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // storage unavailable -- applyLayoutClass still works for this page view
  }
}

/** Applies `layout-mobile`/`layout-desktop` to <html>, replacing
 * whichever was there before. Call on load and on resize/orientation
 * change (see wireLayoutDetection in main.ts). */
export function applyLayoutClass(layout: Layout): void {
  const root = document.documentElement;
  root.classList.remove("layout-mobile", "layout-desktop");
  root.classList.add(layout === "mobile" ? "layout-mobile" : "layout-desktop");
}

export function currentLayout(): Layout {
  const width = window.innerWidth;
  const pointerIsCoarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return detectLayout(width, pointerIsCoarse, getLayoutOverride());
}
