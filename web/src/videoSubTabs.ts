// Part B nav restructure (2026-10-16): "Videos" is one top-level tab over
// three sub-pages -- Esta semana, Todos, Mejores horas. Each of those
// views renders this small pill bar at its own top so she can switch
// between them without going back to the main nav.
import { t, type Lang } from "./i18n";

export const VIDEO_SUB_TABS: { route: string; labelKey: string }[] = [
  { route: "week", labelKey: "nav_this_week" },
  { route: "todos", labelKey: "nav_all" },
  { route: "mejores-horas", labelKey: "nav_mejores_horas" },
];

export function videoSubTabsHtml(activeRoute: string, lang: Lang): string {
  return `
    <nav class="video-sub-tabs">
      ${VIDEO_SUB_TABS.map((tab) => `<a href="#/${tab.route}" class="${tab.route === activeRoute ? "active" : ""}">${t(tab.labelKey, lang)}</a>`).join("")}
    </nav>
  `;
}
