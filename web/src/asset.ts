/** Data files store cached images as root paths ("/img/x.jpg"). The site is
 * served from a sub-path on GitHub Pages (/product-radar/), so turn those into
 * paths relative to the page. Full URLs and protocol-relative URLs pass through. */
export function assetUrl(path: string): string {
  return path.startsWith("/") && !path.startsWith("//") ? `.${path}` : path;
}

/** Shared broken-image fallback (density/redesign pass, 2026-10-16): never
 * show raw broken-image alt text -- every <img> that can fail to load
 * should set onerror="this.onerror=null;this.src='${IMG_FALLBACK}'".
 * %27 stands in for a literal "'" because this constant gets embedded
 * inside a single-quoted JS string inside a double-quoted HTML attribute
 * (onerror="...src='${IMG_FALLBACK}'") -- a raw apostrophe in the svg
 * markup would break out of that string early (the real root cause this
 * pass found and fixed, see avatarFallback.ts). */
export const IMG_FALLBACK =
  "data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2748%27 height=%2748%27><rect width=%2748%27 height=%2748%27 fill=%27%23d8d8d8%27/><path d=%27M14 32l8-10 6 6 6-9 8 13z%27 fill=%27%23bdbdbd%27/></svg>";
