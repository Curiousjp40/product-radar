import { getLang, setLang, t, type Lang } from "./i18n";
import { renderPipeline } from "./views/pipeline";
import { renderProduct } from "./views/product";
import { renderRadar } from "./views/radar";
import { renderResults } from "./views/results";
import { renderSeason } from "./views/season";
import { renderSettings } from "./views/settings";
import { renderThisWeek } from "./views/thisWeek";

const TABS: { route: string; labelKey: string }[] = [
  { route: "week", labelKey: "nav_this_week" },
  { route: "radar", labelKey: "nav_radar" },
  { route: "pipeline", labelKey: "nav_pipeline" },
  { route: "results", labelKey: "nav_results" },
  { route: "season", labelKey: "nav_season" },
  { route: "settings", labelKey: "nav_settings" },
];

function currentRoute(): { name: string; param?: string } {
  const hash = location.hash.replace(/^#\/?/, "");
  if (!hash) return { name: "week" };
  const [name, param] = hash.split("/");
  return { name, param };
}

function renderShell(lang: Lang): void {
  const app = document.getElementById("app")!;
  const route = currentRoute();
  app.innerHTML = `
    <header class="app-header">
      <h1>Product Radar</h1>
      <div class="lang-toggle">
        <button data-lang="es" class="${lang === "es" ? "active" : ""}">ES</button>
        <button data-lang="en" class="${lang === "en" ? "active" : ""}">EN</button>
      </div>
    </header>
    <nav class="tabs">
      ${TABS.map(
        (tab) =>
          `<a href="#/${tab.route}" class="${route.name === tab.route ? "active" : ""}">${t(tab.labelKey, lang)}</a>`,
      ).join("")}
    </nav>
    <main id="view"></main>
  `;
  app.querySelectorAll<HTMLButtonElement>(".lang-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      setLang(btn.dataset.lang as Lang);
      renderApp();
    });
  });
}

async function renderApp(): Promise<void> {
  const lang = getLang();
  setLang(lang);
  renderShell(lang);
  const view = document.getElementById("view")!;
  const route = currentRoute();
  switch (route.name) {
    case "week":
      await renderThisWeek(view, lang);
      break;
    case "radar":
      await renderRadar(view, lang);
      break;
    case "product":
      await renderProduct(view, lang, route.param ?? "");
      break;
    case "pipeline":
      await renderPipeline(view, lang);
      break;
    case "results":
      await renderResults(view, lang);
      break;
    case "season":
      await renderSeason(view, lang);
      break;
    case "settings":
      await renderSettings(view, lang);
      break;
    default:
      await renderThisWeek(view, lang);
  }
}

window.addEventListener("hashchange", () => void renderApp());
void renderApp();
