/** Density/redesign pass (2026-10-16): when a host/product image has no
 * URL or fails to load, never show raw broken-image alt text -- fall back
 * to host initials in a colored circle (data: URI SVG), pure + unit
 * tested so the color/initials logic is verifiable without a DOM. */
const CIRCLE_COLORS = ["#6b5ca5", "#1f7a5c", "#b5562f", "#2f6fb5", "#9c4f8a", "#5c7a1f"];

export function initialsFromHandle(handle: string): string {
  const clean = handle.replace(/^@/, "").trim();
  if (!clean) return "?";
  const letters = clean.match(/[a-zA-Z0-9]/g);
  if (!letters || letters.length === 0) return "?";
  return letters.slice(0, 2).join("").toUpperCase();
}

export function colorForHandle(handle: string): string {
  let hash = 0;
  for (let i = 0; i < handle.length; i++) hash = (hash * 31 + handle.charCodeAt(i)) >>> 0;
  return CIRCLE_COLORS[hash % CIRCLE_COLORS.length];
}

export function initialsCircleDataUri(handle: string, size = 64): string {
  const initials = initialsFromHandle(handle);
  const color = colorForHandle(handle);
  const fontSize = Math.round(size * 0.38);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><circle cx='${size / 2}' cy='${size / 2}' r='${size / 2}' fill='${color}'/><text x='50%' y='53%' text-anchor='middle' dominant-baseline='middle' font-family='sans-serif' font-size='${fontSize}' fill='white' font-weight='600'>${initials}</text></svg>`;
  // encodeURIComponent does NOT escape "'" -- left raw, it breaks out of an
  // inline onerror="...src='${...}'" HTML attribute's single-quoted JS
  // string (real bug found 2026-10-16: broken host avatars/alt text was
  // this, not a backend image-path problem -- see CLAUDE.md). Escape it
  // explicitly rather than switching the svg to double quotes, since the
  // outer HTML attribute is double-quoted too.
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg).replace(/'/g, "%27")}`;
}
