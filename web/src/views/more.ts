import { loadMeta } from "../api";
import { fetchCreditsSummary } from "../credits";
import { t, type Lang } from "../i18n";

// Part B nav restructure (2026-10-16): "Mejores horas" moved under the
// Videos tab's own sub-tabs, "En vivo" promoted to a main tab, and the
// legacy "Muestras (antiguo)" link removed from here -- its route/data
// still exist (other flows still write to it), just no longer linked.
// Design review follow-up (Ryan): "Buscar cuenta" + "Comparar cuentas"
// merged into the new Cuentas main tab (views/cuentas.ts), no longer
// linked from here.
const LINKS: { route: string; labelKey: string }[] = [
  { route: "pipeline", labelKey: "nav_pipeline" },
  { route: "outreach", labelKey: "nav_outreach" },
  { route: "ocultos", labelKey: "nav_ocultos" },
  { route: "mi-dinero", labelKey: "nav_mi_dinero" },
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

  void Promise.all([fetchCreditsSummary(), loadMeta().catch(() => null)]).then(([summary, meta]) => {
    const widget = container.querySelector(".credits-widget");
    if (!widget) return;
    if (!summary) {
      widget.innerHTML = `<h3>${t("credits_widget_title", lang)}</h3><p class="empty-state" style="padding:4px 0">${t("credits_widget_unavailable", lang)}</p>`;
      return;
    }
    const total = summary.plan_credits_remaining + summary.topup_credits_remaining;
    const avgPerRun = meta?.data?.avg_credits_per_run ?? null;
    const avgLine =
      avgPerRun !== null
        ? t("credits_widget_avg_per_run", lang, { n: Math.round(avgPerRun) })
        : t("credits_widget_avg_per_run_unknown", lang);
    widget.innerHTML = `
      <h3>${t("credits_widget_title", lang)}</h3>
      <p class="goal-progress-text">${t("credits_widget_remaining", lang, { n: total })}</p>
      <p class="goal-progress-text" style="color:var(--text-dim)">
        ${t("credits_widget_plan", lang, { n: summary.plan_credits_remaining })} &middot;
        ${t("credits_widget_topup", lang, { n: summary.topup_credits_remaining })}
      </p>
      <p class="goal-progress-text" style="color:var(--text-dim)">${t("credits_widget_reset", lang, { date: formatResetDate(summary.plan_expire_at, lang) })}</p>
      <p class="goal-progress-text" style="color:var(--text-dim)">${avgLine}</p>
    `;
  });
}
