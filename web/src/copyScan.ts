/** Design review section 0 item 7 / section 6 definition-of-done: no
 * developer words or raw keys in the UI (e.g. `beauty_hair`, `seasonal`)
 * and no bare ISO dates (`2026-11-01`). Pure so it can run over any list of
 * user-facing strings (the i18n dict, or a rendered page's text) in a test. */

const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/;
// A lowercase_with_underscores token that looks like a raw data/category
// key, not natural written text (which never contains "_").
const RAW_KEY_RE = /\b[a-z]+(?:_[a-z0-9]+)+\b/;

export interface CopyScanIssue {
  text: string;
  reason: "raw_key" | "iso_date";
}

export function scanCopyForLeaks(strings: string[]): CopyScanIssue[] {
  const issues: CopyScanIssue[] = [];
  for (const text of strings) {
    if (RAW_KEY_RE.test(text)) issues.push({ text, reason: "raw_key" });
    if (ISO_DATE_RE.test(text)) issues.push({ text, reason: "iso_date" });
  }
  return issues;
}
