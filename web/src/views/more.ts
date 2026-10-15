import { t, type Lang } from "../i18n";

const LINKS: { route: string; labelKey: string }[] = [
  { route: "results", labelKey: "nav_results" },
  { route: "season", labelKey: "nav_season" },
  { route: "settings", labelKey: "nav_settings" },
];

export function renderMore(container: HTMLElement, lang: Lang): void {
  container.innerHTML = `
    <h2 class="view-title">${t("more_title", lang)}</h2>
    <div class="more-list">
      ${LINKS.map((link) => `<a class="more-link" href="#/${link.route}">${t(link.labelKey, lang)}</a>`).join("")}
    </div>
  `;
}
