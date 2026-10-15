/** Data files store cached images as root paths ("/img/x.jpg"). The site is
 * served from a sub-path on GitHub Pages (/product-radar/), so turn those into
 * paths relative to the page. Full URLs and protocol-relative URLs pass through. */
export function assetUrl(path: string): string {
  return path.startsWith("/") && !path.startsWith("//") ? `.${path}` : path;
}
