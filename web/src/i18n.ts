export type Lang = "es" | "en";

const STORAGE_KEY = "product-radar:lang";

const dict: Record<string, { es: string; en: string }> = {
  nav_this_week: { es: "Esta semana", en: "This week" },
  nav_radar: { es: "Radar", en: "Radar" },
  nav_pipeline: { es: "Mi lista", en: "My list" },
  nav_results: { es: "Mis resultados", en: "My results" },
  nav_season: { es: "Temporada", en: "Season" },
  nav_settings: { es: "Ajustes", en: "Settings" },
  nav_more: { es: "Mas", en: "More" },
  more_title: { es: "Mas", en: "More" },
  this_week_title: { es: "Esta semana", en: "This week" },
  shortlist: { es: "A mi lista", en: "Shortlist" },
  not_for_me: { es: "No es para mi", en: "Not for me" },
  see_details: { es: "Ver detalles", en: "View details" },
  save_to_list: { es: "Guardar en mi lista", en: "Save to my list" },
  price: { es: "Precio", en: "Price" },
  commission: { es: "Comision", en: "Commission" },
  per_sale: { es: "Por venta", en: "Per sale" },
  score: { es: "Puntaje", en: "Score" },
  ev_typical: { es: "Tipico", en: "Typical" },
  ev_upside: { es: "Si le va bien", en: "If it does well" },
  stage_emerging: { es: "Emergente", en: "Emerging" },
  stage_rising: { es: "Subiendo", en: "Rising" },
  stage_peak: { es: "Pico", en: "Peak" },
  stage_evergreen: { es: "Siempre vigente", en: "Evergreen" },
  stage_declining: { es: "Bajando", en: "Declining" },
  stage_new_to_radar: { es: "Nuevo en el radar", en: "New to radar" },
  // Short tags for the simplified card (added 2026-10-16) -- the full
  // stage_* labels above are still used on the candidates/radar table.
  tag_emerging: { es: "Emergiendo", en: "Emerging" },
  tag_rising: { es: "Subiendo", en: "Rising" },
  tag_peak: { es: "Popular", en: "Popular" },
  tag_evergreen: { es: "Clasico", en: "Classic" },
  tag_declining: { es: "Bajando", en: "Fading" },
  tag_new_to_radar: { es: "Nuevo", en: "New" },
  kind_core: { es: "Principal", en: "Core" },
  kind_explore: { es: "Prueba", en: "Explore" },
  kind_evergreen: { es: "Vigente", en: "Evergreen" },
  kind_winner_again: { es: "Ganador de nuevo", en: "Winner again" },
  radar_title: { es: "Todos los candidatos", en: "All candidates" },
  category: { es: "Categoria", en: "Category" },
  stage: { es: "Etapa", en: "Stage" },
  pipeline_title: { es: "Mi lista de productos", en: "My product list" },
  open_in_fastmoss: { es: "Ver en FastMoss", en: "View on FastMoss" },
  sales_trend_title: { es: "Ventas de los ultimos 14 dias", en: "Sales over the last 14 days" },
  videos_selling_title: { es: "Videos que venden este producto", en: "Videos selling this product" },
  product_not_found: { es: "No encontramos este producto.", en: "We couldn't find this product." },
  back_to_week: { es: "Volver a esta semana", en: "Back to this week" },
  views_short: { es: "vistas", en: "views" },
  status_shortlisted: { es: "En mi lista", en: "Shortlisted" },
  status_sample_requested: { es: "Muestra pedida", en: "Sample requested" },
  status_sample_received: { es: "Muestra recibida", en: "Sample received" },
  status_filmed: { es: "Filmado", en: "Filmed" },
  status_posted: { es: "Publicado", en: "Posted" },
  status_skipped: { es: "Omitido", en: "Skipped" },
  results_title: { es: "Como te esta yendo", en: "How you're doing" },
  length_sweet_spot: { es: "Duracion ideal del video", en: "Video length sweet spot" },
  hit_tracker: { es: "Tus videos mas fuertes", en: "Your strongest videos" },
  benchmark: { es: "Comparacion con Ari", en: "Benchmark vs Ari" },
  season_title: { es: "Calendario de temporadas", en: "Season calendar" },
  settings_title: { es: "Ajustes", en: "Settings" },
  settings_coming_soon: {
    es: "La edicion de ajustes llega en una fase futura. Por ahora, edita config/settings.yaml.",
    en: "Editing settings from here arrives in a later phase. For now, edit config/settings.yaml.",
  },
  sample_data_banner: {
    es: "Datos de muestra -- esto no es real todavia (Fase 0a)",
    en: "Sample data -- this isn't real yet (Phase 0a)",
  },
  no_data: { es: "No hay datos disponibles.", en: "No data available." },
  videos_per_week: { es: "videos por semana", en: "videos per week" },
  top1_share: { es: "GMV del video #1", en: "GMV from video #1" },
  top5_share: { es: "GMV de los 5 mejores", en: "GMV from top 5" },
};

export function getLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "en" ? "en" : "es";
}

export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore (private browsing, storage disabled, etc.)
  }
  document.documentElement.lang = lang;
}

export function t(key: string, lang: Lang): string {
  const entry = dict[key];
  if (!entry) return key;
  return entry[lang];
}
