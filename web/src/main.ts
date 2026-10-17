import { getLang, setLang, t, type Lang } from "./i18n";
import { applyLayoutClass, currentLayout, setLayoutOverride } from "./layoutDetect";
import { pullHiddenCategories } from "./pipeline";
import { renderCuentas, type CuentasSubTab } from "./views/cuentas";
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
const TAB_ICONS: Record<string, string> = {
  hoy: '<path d="M12 3l8 6v11a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1V9z"/>',
  week: '<path d="M4 5h16v3H4zM4 11h16v8H4zM8 11v8M14 11v8"/>',
  "en-vivo": '<circle cx="12" cy="12" r="3"/><path d="M5 12a7 7 0 0 1 7-7M19 12a7 7 0 0 1-7 7M5 12a7 7 0 0 0 7 7M19 12a7 7 0 0 0-7-7"/>',
  cuentas: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 19a4 4 0 0 1 6.6-3"/>',
  "mis-productos": '<path d="M4 7l8-4 8 4v10l-8 4-8-4z"/><path d="M4 7l8 4 8-4M12 11v10"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
};

const TABS: { route: string; labelKey: string }[] = [
  { route: "hoy", labelKey: "nav_hoy" },
  { route: "week", labelKey: "nav_videos" },
  { route: "en-vivo", labelKey: "nav_en_vivo" },
  { route: "cuentas", labelKey: "nav_cuentas" },
  { route: "mis-productos", labelKey: "nav_mis_productos" },
  { route: "more", labelKey: "nav_more" },
];
const VIDEO_ROUTES = new Set(["week", "todos", "mejores-horas"]);
const MORE_ROUTES = new Set(["settings", "pipeline", "outreach", "ocultos", "muestras", "mi-dinero"]);

function currentRoute(): { name: string; param?: string; param2?: string } {
  const hash = location.hash.replace(/^#\/?/, "");
  if (!hash) return { name: "hoy" };
  const [name, param, param2] = hash.split("/");
  return { name, param, param2 };
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
              : tab.route === "cuentas"
                ? route.name === "cuentas" || route.name === "buscar" || route.name === "comparar-cuentas"
                : route.name === tab.route;
        return `<a href="#/${tab.route}" class="${isActive ? "active" : ""}">
          <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TAB_ICONS[tab.route]}</svg>
          <span class="tab-label">${t(tab.labelKey, lang)}</span>
        </a>`;
      }).join("")}
    </nav>
    <main id="view"></main>
    <footer class="app-footer">
      <button type="button" class="link-button" data-vista-footer-toggle>
        ${currentLayout() === "mobile" ? t("vista_footer_link_desktop", lang) : t("vista_footer_link_mobile", lang)}
      </button>
    </footer>
  `;
  app.querySelectorAll<HTMLButtonElement>(".lang-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      setLang(btn.dataset.lang as Lang);
      renderApp();
    });
  });
  wireSyncIndicator(app, () => renderShell(lang));
  app.querySelector<HTMLButtonElement>("[data-vista-footer-toggle]")?.addEventListener("click", () => {
    setLayoutOverride(currentLayout() === "mobile" ? "desktop" : "mobile");
    applyLayoutClass(currentLayout());
    renderShell(lang);
  });
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
    case "cuentas":
      await renderCuentas(view, lang, (route.param as CuentasSubTab) || "buscar", route.param2);
      break;
    // Old routes kept working as redirects (design review follow-up:
    // merged into the Cuentas main tab) so nothing that linked to them
    // breaks.
    case "buscar":
      await renderCuentas(view, lang, "buscar", route.param);
      break;
    case "comparar-cuentas":
      await renderCuentas(view, lang, "comparar");
      break;
    case "mi-dinero":
      await renderMiDinero(view, lang);
      break;
    case "season":
    case "temporadas":
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

// Section 1b: applied before first paint (synchronously, right here at
// module load) so there's never a flash of the wrong layout; re-applied
// on resize/orientation change so rotating a tablet or resizing a
// desktop window across the 1024px line updates live.
applyLayoutClass(currentLayout());
window.addEventListener("resize", () => applyLayoutClass(currentLayout()));
window.addEventListener("orientationchange", () => applyLayoutClass(currentLayout()));

window.addEventListener("hashchange", () => void renderApp());
void renderApp();
