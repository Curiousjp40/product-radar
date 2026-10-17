import { eventKind } from "./seasonLogic";

export interface SeasonTheme {
  bg: string;
  fg: string;
  accent: string;
  icon: string;
}

// Design review's own color suggestions for the hero banner/event-card
// accent, keyed by eventKind(id) so the yearly id suffix doesn't matter.
const THEMES: Record<string, SeasonTheme> = {
  halloween: { bg: "#2b1a0f", fg: "#ffb347", accent: "#ff7a1a", icon: "🎃" },
  bfcm: { bg: "#141414", fg: "#e8c468", accent: "#d4af37", icon: "🛍️" },
  holiday_gifting: { bg: "#7a1f1f", fg: "#f5e9d6", accent: "#2f7a4f", icon: "🎁" },
  winter_new_year: { bg: "#17324a", fg: "#eaf4ff", accent: "#5fb0e0", icon: "❄️" },
  valentines: { bg: "#5c1f3a", fg: "#ffd9e6", accent: "#e8558f", icon: "💝" },
  mothers_day: { bg: "#4b3a66", fg: "#f3e9ff", accent: "#b795e0", icon: "💐" },
  graduation: { bg: "#1f2d4b", fg: "#f0e6c8", accent: "#c9a24b", icon: "🎓" },
  deals_for_you_days: { bg: "#111827", fg: "#e6fffa", accent: "#25f4ee", icon: "🛒" },
  back_to_school: { bg: "#5c4a0f", fg: "#fff6d9", accent: "#e0b32d", icon: "🎒" },
};

const DEFAULT_THEME: SeasonTheme = { bg: "var(--surface-2)", fg: "var(--text)", accent: "var(--accent)", icon: "📅" };

export function themeForEvent(id: string): SeasonTheme {
  return THEMES[eventKind(id)] ?? DEFAULT_THEME;
}
