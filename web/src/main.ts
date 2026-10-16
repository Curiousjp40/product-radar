import { getLang, setLang, t, type Lang } from "./i18n";
import { renderBuscarCuenta } from "./views/buscarCuenta";
import { renderCompararCuentas } from "./views/compararCuentas";
import { renderHoy } from "./views/hoy";
import { renderMejoresHoras } from "./views/mejoresHoras";
import { renderMiDinero } from "./views/miDinero";
import { renderMisProductos } from "./views/misProductos";
import { renderMore } from "./views/more";
import { renderOcultos } from "./views/ocultos";
import { renderOutreach } from "./views/outreach";
import { renderPipeline } from "./views/pipeline";
import { renderProduct } from "./views/product";
import { renderSamples } from "./views/samples";
import { renderSeason } from "./views/season";
import { renderSettings } from "./views/settings";
import { renderThisWeek } from "./views/thisWeek";
import { renderTodos } from "./views/todos";

// Tabs (Part D, added 2026-10-15; Muestras replaced by Mis Productos
// 2026-10-16, Part C5): Hoy / Esta semana / Todos / Mis Productos / Mas.
// The old Muestras page/data still exists at #/muestras (linked from Mas,
// not deleted) since its request-sample buttons elsewhere on the site
// still write to it -- Mis Productos is the new primary inventory/pipeline
// view, synced across devices via the Worker, superseding Muestras as the
// main tab without breaking what already pointed at the old one.
const TABS: { route: string; labelKey: string }[] = [
  { route: "hoy", labelKey: "nav_hoy" },
  { route: "week", labelKey: "nav_this_week" },
  { route: "todos", labelKey: "nav_all" },
  { route: "mis-productos", labelKey: "nav_mis_productos" },
  { route: "more", labelKey: "nav_more" },
];
const MORE_ROUTES = new Set(["buscar", "season", "settings", "pipeline", "outreach", "ocultos", "mejores-horas", "muestras", "comparar-cuentas", "mi-dinero"]);

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
    case "mis-productos":
      await renderMisProductos(view, lang);
      break;
    case "ocultos":
      await renderOcultos(view, lang);
      break;
    case "mejores-horas":
      await renderMejoresHoras(view, lang);
      break;
    case "buscar":
      renderBuscarCuenta(view, lang);
      break;
    case "comparar-cuentas":
      await renderCompararCuentas(view, lang);
      break;
    case "mi-dinero":
      await renderMiDinero(view, lang);
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
