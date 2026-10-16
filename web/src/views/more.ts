import { fetchCreditsSummary } from "../credits";
import { t, type Lang } from "../i18n";

const LINKS: { route: string; labelKey: string }[] = [
  { route: "pipeline", labelKey: "nav_pipeline" },
  { route: "outreach", labelKey: "nav_outreach" },
  { route: "buscar", labelKey: "nav_buscar_cuenta" },
  { route: "ocultos", labelKey: "nav_ocultos" },
  { route: "mejores-horas", labelKey: "nav_mejores_horas" },
  { route: "muestras", labelKey: "nav_muestras_legacy" },
  { route: "season", labelKey: "nav_season" },
  { route: "settings", labelKey: "nav_settings" },
];

function formatResetDate(isoLike: string, lang: Lang): string {
  const date = new Date(isoLike.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return isoLike;
  return date.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { month: "short", day: "numeric" });
}

export function renderMore(container: HTMLElement, lang: Lang): void {
  container.innerHTML = `
    <h2 class="view-title">${t("more_title", lang)}</h2>
    <div class="insight-card credits-widget">
      <h3>${t("credits_widget_title", lang)}</h3>
      <p class="empty-state" style="padding:4px 0">...</p>
    </div>
    <div class="more-list">
      ${LINKS.map((link) => `<a class="more-link" href="#/${link.route}">${t(link.labelKey, lang)}</a>`).join("")}
    </div>
  `;

  void fetchCreditsSummary().then((summary) => {
    const widget = container.querySelector(".credits-widget");
    if (!widget) return;
    if (!summary) {
      widget.innerHTML = `<h3>${t("credits_widget_title", lang)}</h3><p class="empty-state" style="padding:4px 0">${t("credits_widget_unavailable", lang)}</p>`;
      return;
    }
    const total = summary.plan_credits_remaining + summary.topup_credits_remaining;
    widget.innerHTML = `
      <h3>${t("credits_widget_title", lang)}</h3>
      <p class="goal-progress-text">${t("credits_widget_remaining", lang, { n: total })}</p>
      <p class="goal-progress-text" style="color:var(--text-dim)">
        ${t("credits_widget_plan", lang, { n: summary.plan_credits_remaining })} &middot;
        ${t("credits_widget_topup", lang, { n: summary.topup_credits_remaining })}
      </p>
      <p class="goal-progress-text" style="color:var(--text-dim)">${t("credits_widget_reset", lang, { date: formatResetDate(summary.plan_expire_at, lang) })}</p>
      ${summary.avg_credits_per_week !== null ? `<p class="goal-progress-text" style="color:var(--text-dim)">${t("credits_widget_avg_per_week", lang, { n: summary.avg_credits_per_week })}</p>` : ""}
    `;
  });
}
