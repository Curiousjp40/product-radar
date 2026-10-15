import { getLang, setLang, t, type Lang } from "./i18n";
import { renderBuscarCuenta } from "./views/buscarCuenta";
import { renderMore } from "./views/more";
import { renderPipeline } from "./views/pipeline";
import { renderProduct } from "./views/product";
import { renderSeason } from "./views/season";
import { renderSettings } from "./views/settings";
import { renderThisWeek } from "./views/thisWeek";
import { renderTodos } from "./views/todos";

// 4 tabs (redesign 2026-10-18): Esta semana / Todos / Mi lista / Mas.
// "Todos" replaces the old "Radar" page as a main tab (same "every
// candidate" purpose, new ranked-row design); results/season/settings stay
// under "Mas" so the bottom-of-phone nav doesn't scroll sideways.
const TABS: { route: string; labelKey: string }[] = [
  { route: "week", labelKey: "nav_this_week" },
  { route: "todos", labelKey: "nav_all" },
  { route: "pipeline", labelKey: "nav_pipeline" },
  { route: "more", labelKey: "nav_more" },
];
const MORE_ROUTES = new Set(["buscar", "season", "settings"]);

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
      ${TABS.map((tab) => {
        const isActive = tab.route === "more" ? route.name === "more" || MORE_ROUTES.has(route.name) : route.name === tab.route;
        return `<a href="#/${tab.route}" class="${isActive ? "active" : ""}">${t(tab.labelKey, lang)}</a>`;
      }).join("")}
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
    case "todos":
      await renderTodos(view, lang);
      break;
    case "product":
      await renderProduct(view, lang, route.param ?? "");
      break;
    case "pipeline":
      await renderPipeline(view, lang);
      break;
    case "buscar":
      renderBuscarCuenta(view, lang);
      break;
    case "season":
      await renderSeason(view, lang);
      break;
    case "settings":
      await renderSettings(view, lang);
      break;
    case "more":
      renderMore(view, lang);
      break;
    default:
      await renderThisWeek(view, lang);
  }
}

window.addEventListener("hashchange", () => void renderApp());
void renderApp();
