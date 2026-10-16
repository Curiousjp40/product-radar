import { getLang, setLang, t, type Lang } from "./i18n";
import { pullHiddenCategories } from "./pipeline";
import { renderBuscarCuenta } from "./views/buscarCuenta";
import { renderCompararCuentas } from "./views/compararCuentas";
import { renderEnVivo } from "./views/enVivo";
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
import { syncIndicatorHtml, wireSyncIndicator } from "./syncIndicator";

// Tabs, rebuilt 2026-10-16 (Part B): Hoy / Videos / En vivo / Mis
// Productos / Mas. "Videos" is one tab over three sub-pages (Esta semana,
// Todos, Mejores horas -- see VIDEO_SUB_TABS/videoSubTabsHtml below); "En
// vivo" is promoted out of Mas into a main section. The old Muestras
// page/route still exists (its request-sample buttons elsewhere still
// write to it) but is no longer linked from Mas's own list.
const TABS: { route: string; labelKey: string }[] = [
  { route: "hoy", labelKey: "nav_hoy" },
  { route: "week", labelKey: "nav_videos" },
  { route: "en-vivo", labelKey: "nav_en_vivo" },
  { route: "mis-productos", labelKey: "nav_mis_productos" },
  { route: "more", labelKey: "nav_more" },
];
const VIDEO_ROUTES = new Set(["week", "todos", "mejores-horas"]);
const MORE_ROUTES = new Set(["buscar", "season", "settings", "pipeline", "outreach", "ocultos", "muestras", "comparar-cuentas", "mi-dinero"]);

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
    ${syncIndicatorHtml(lang)}
    <nav class="tabs">
      ${TABS.map((tab) => {
        const isActive =
          tab.route === "more"
            ? route.name === "more" || MORE_ROUTES.has(route.name)
            : tab.route === "week"
              ? VIDEO_ROUTES.has(route.name)
              : route.name === tab.route;
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
  wireSyncIndicator(app, () => renderShell(lang));
}

async function renderApp(): Promise<void> {
  const lang = getLang();
  setLang(lang);
  renderShell(lang);
  await pullHiddenCategories();
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
    case "en-vivo":
      await renderEnVivo(view, lang);
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
