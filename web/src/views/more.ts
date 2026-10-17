import { loadCandidates } from "../api";
import { getEntries, getMonthlyGoal } from "../earningsGoal";
import { earningsThisMonth } from "../earningsGoalLogic";
import { t, type Lang } from "../i18n";
import { outreachShops } from "../outreach";
import { getAllFeedback, getAllStatuses, getHiddenCategories } from "../pipeline";

// Design review 3.10: "Mas" became a grid of cards with an icon, a
// one-line description, and a live preview value -- was an unexplained
// flat list of bare links. "Buscar cuenta"/"Comparar cuentas" merged
// into the Cuentas main tab and "Temporadas" moved to its own page
// earlier this session, so only these 5 remain here (matches the review's
// list minus those two, which it didn't anticipate becoming main tabs).
interface MoreCard {
  route: string;
  labelKey: string;
  descKey: string;
  icon: string;
  preview: (ctx: PreviewContext) => string;
}

interface PreviewContext {
  lang: Lang;
  savedCount: number;
  shopCount: number;
  hiddenCount: number;
  earnedThisMonth: number;
  monthlyGoal: number | null;
}

function formatMoney(n: number): string {
  return `$${n.toFixed(0)}`;
}

const CARDS: MoreCard[] = [
  {
    route: "pipeline",
    labelKey: "nav_pipeline",
    descKey: "more_desc_pipeline",
    icon: "♡",
    preview: (ctx) => t("more_preview_count", ctx.lang, { n: ctx.savedCount }),
  },
  {
    route: "outreach",
    labelKey: "nav_outreach",
    descKey: "more_desc_outreach",
    icon: "🏬",
    preview: (ctx) => t("more_preview_count", ctx.lang, { n: ctx.shopCount }),
  },
  {
    route: "ocultos",
    labelKey: "nav_ocultos",
    descKey: "more_desc_ocultos",
    icon: "🙈",
    preview: (ctx) => t("more_preview_count", ctx.lang, { n: ctx.hiddenCount }),
  },
  {
    route: "mi-dinero",
    labelKey: "nav_mi_dinero",
    descKey: "more_desc_mi_dinero",
    icon: "💰",
    preview: (ctx) =>
      ctx.monthlyGoal
        ? t("more_preview_money_of_goal", ctx.lang, { earned: formatMoney(ctx.earnedThisMonth), goal: formatMoney(ctx.monthlyGoal) })
        : t("more_preview_money", ctx.lang, { earned: formatMoney(ctx.earnedThisMonth) }),
  },
  {
    route: "settings",
    labelKey: "nav_settings",
    descKey: "more_desc_settings",
    icon: "⚙️",
    preview: () => "",
  },
];

export async function renderMore(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const [statuses, feedback, { data: candidatesData }, entries, monthlyGoal] = await Promise.all([
    getAllStatuses(),
    getAllFeedback(),
    loadCandidates(),
    getEntries(),
    getMonthlyGoal(),
  ]);
  const savedCount = Object.values(statuses).filter((s) => s === "shortlisted").length;
  const hiddenCount = getHiddenCategories().length + Object.values(feedback).filter((f) => f === "not_for_me").length;
  const shopCount = outreachShops(candidatesData.candidates).length;
  const earnedThisMonth = earningsThisMonth(entries, new Date());

  const ctx: PreviewContext = { lang, savedCount, shopCount, hiddenCount, earnedThisMonth, monthlyGoal };

  container.innerHTML = `
    <h2 class="view-title">${t("more_title", lang)}</h2>
    <div class="more-grid">
      ${CARDS.map(
        (card) => `
        <a class="more-card" href="#/${card.route}">
          <span class="more-card-icon">${card.icon}</span>
          <span class="more-card-name">${t(card.labelKey, lang)}</span>
          <span class="more-card-desc">${t(card.descKey, lang)}</span>
          ${card.preview(ctx) ? `<span class="more-card-preview">${card.preview(ctx)}</span>` : ""}
        </a>
      `,
      ).join("")}
    </div>
  `;
}
