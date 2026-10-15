import { getLang, setLang, t, type Lang } from "./i18n";
import { renderBuscarCuenta } from "./views/buscarCuenta";
import { renderHoy } from "./views/hoy";
import { renderMore } from "./views/more";
import { renderOutreach } from "./views/outreach";
import { renderPipeline } from "./views/pipeline";
import { renderProduct } from "./views/product";
import { renderSamples } from "./views/samples";
import { renderSeason } from "./views/season";
import { renderSettings } from "./views/settings";
import { renderThisWeek } from "./views/thisWeek";
import { renderTodos } from "./views/todos";

// Tabs (Part D, added 2026-10-15): Hoy / Esta semana / Todos / Muestras /
// Mas -- Mi lista moved under Mas. Kept them separate rather than merging
// Mi lista into Muestras: Mi lista is a lightweight status tracker across
// every stage (including "skipped", "sample_requested" -- things that
// never need a physical sample at all, e.g. filming from stock she already
// owns), while Muestras has its own richer record (received date, value,
// a post-by deadline, an optional TikTok link) that only makes sense once
// a physical sample actually exists. Merging them would either lose that
// lightweight tracking or force every shortlisted item through sample
// fields it doesn't have.
const TABS: { route: string; labelKey: string }[] = [
  { route: "hoy", labelKey: "nav_hoy" },
  { route: "week", labelKey: "nav_this_week" },
  { route: "todos", labelKey: "nav_all" },
  { route: "muestras", labelKey: "nav_muestras" },
  { route: "more", labelKey: "nav_more" },
];
const MORE_ROUTES = new Set(["buscar", "season", "settings", "pipeline", "outreach"]);

function currentRoute(): { name: string; param?: string } {
  const hash = location.hash.replace(/^#\/?/, "");
  if (!hash) return { name: "hoy" };
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
    case "hoy":
      await renderHoy(view, lang);
      break;
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
    case "outreach":
      await renderOutreach(view, lang);
      break;
    case "muestras":
      await renderSamples(view, lang);
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
      await renderHoy(view, lang);
  }
}

window.addEventListener("hashchange", () => void renderApp());
void renderApp();
