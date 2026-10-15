// H3 (effort vs pay), part of the 2026-10-15 creator-workflow upgrade.
// 1 sale per video is a known simplification (same one H1 uses) -- there's
// no per-video conversion data saved, so this is "if this video gets one
// sale" rather than a measured rate.
export function earningsPerHour(earningsPerSale: number, effortMinutes: number | null): number | null {
  if (!effortMinutes || effortMinutes <= 0) return null;
  return earningsPerSale / (effortMinutes / 60);
}
