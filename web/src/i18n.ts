export type Lang = "es" | "en";

const STORAGE_KEY = "product-radar:lang";

// Latin American Spanish (es-419): Roxie and her audience are Venezuelan.
// Tu voice throughout, never vosotros/vosotras; "video" (no accent) and
// "celular", never the Spain forms "vídeo"/"móvil". Dates/numbers that go
// through Intl should use locale(), not a bare "es"/"en" string -- prices
// stay US format ($38.99) regardless of language, since it's the US TikTok
// Shop.
export function locale(lang: Lang): string {
  return lang === "es" ? "es-419" : "en-US";
}

const dict: Record<string, { es: string; en: string }> = {
  nav_this_week: { es: "Esta semana", en: "This week" },
  nav_all: { es: "Todos", en: "All" },
  group_fashion: { es: "Moda", en: "Fashion" },
  group_home: { es: "Hogar", en: "Home" },
  all_categories: { es: "Todas", en: "All" },
  units_sold_short: { es: "vendidos", en: "sold" },
  nav_pipeline: { es: "Mi lista", en: "My list" },
  nav_buscar_cuenta: { es: "Buscar cuenta", en: "Search account" },
  nav_season: { es: "Temporada", en: "Season" },
  nav_settings: { es: "Ajustes", en: "Settings" },
  nav_more: { es: "Más", en: "More" },
  more_title: { es: "Más", en: "More" },
  this_week_title: { es: "Esta semana", en: "This week" },
  shortlist: { es: "A mi lista", en: "Shortlist" },
  not_for_me: { es: "No es para mí", en: "Not for me" },
  see_details: { es: "Ver detalles", en: "View details" },
  save_to_list: { es: "Guardar en mi lista", en: "Save to my list" },
  open_in_tiktok: { es: "Ver en TikTok", en: "Open in TikTok" },
  tiktok_videos_button: { es: "Ver videos en TikTok", en: "Watch videos on TikTok" },
  earn_headline: { es: "Ganas ${amount} por venta", en: "You earn ${amount} per sale" },
  commission: { es: "Comisión", en: "Commission" },
  per_sale: { es: "Por venta", en: "Per sale" },
  score: { es: "Puntaje", en: "Score" },
  ev_typical: { es: "Típico", en: "Typical" },
  ev_upside: { es: "Si le va bien", en: "If it does well" },
  stage_emerging: { es: "Emergente", en: "Emerging" },
  stage_rising: { es: "Subiendo", en: "Rising" },
  stage_peak: { es: "Pico", en: "Peak" },
  stage_evergreen: { es: "Siempre vigente", en: "Evergreen" },
  stage_declining: { es: "Bajando", en: "Declining" },
  stage_new_to_radar: { es: "Nuevo en el radar", en: "New to radar" },
  // Short tags for the simplified card (added 2026-10-16) -- the full
  // stage_* labels above are still used on the products/radar table.
  tag_emerging: { es: "Emergiendo", en: "Emerging" },
  tag_rising: { es: "Subiendo", en: "Rising" },
  tag_peak: { es: "Popular", en: "Popular" },
  tag_evergreen: { es: "Clásico", en: "Classic" },
  tag_declining: { es: "Bajando", en: "Fading" },
  tag_new_to_radar: { es: "Nuevo", en: "New" },
  kind_core: { es: "Principal", en: "Core" },
  kind_explore: { es: "Prueba", en: "Explore" },
  kind_evergreen: { es: "Vigente", en: "Evergreen" },
  kind_winner_again: { es: "Ganador de nuevo", en: "Winner again" },
  category: { es: "Categoría", en: "Category" },
  stage: { es: "Etapa", en: "Stage" },
  suspicious_label: { es: "Sospechoso", en: "Suspicious" },
  pipeline_title: { es: "Mi lista de productos", en: "My product list" },
  pipeline_empty: { es: "Todavía no has agregado nada a tu lista.", en: "You haven't shortlisted anything yet." },
  product_col: { es: "Producto", en: "Product" },
  status_col: { es: "Estado", en: "Status" },
  open_in_fastmoss: { es: "Ver en FastMoss", en: "View on FastMoss" },
  sold_this_week: { es: "Vendidos esta semana", en: "Sold this week" },
  total_sales: { es: "Ventas totales", en: "Total sales" },
  creators_selling: { es: "Creadoras vendiéndolo", en: "Creators selling it" },
  videos_count_label: { es: "Videos", en: "Videos" },
  sales_trend_title: { es: "Ventas de los últimos 14 días", en: "Sales over the last 14 days" },
  videos_selling_title: { es: "Videos que venden este producto", en: "Videos selling this product" },
  sales_short: { es: "ventas", en: "sales" },
  product_not_found: { es: "No encontramos este producto.", en: "We couldn't find this product." },
  back_to_week: { es: "Volver a esta semana", en: "Back to this week" },
  views_short: { es: "vistas", en: "views" },
  status_shortlisted: { es: "En mi lista", en: "Shortlisted" },
  status_sample_requested: { es: "Muestra pedida", en: "Sample requested" },
  status_sample_received: { es: "Muestra recibida", en: "Sample received" },
  status_filmed: { es: "Filmado", en: "Filmed" },
  status_posted: { es: "Publicado", en: "Posted" },
  status_skipped: { es: "Omitido", en: "Skipped" },
  sales_label: { es: "Ventas", en: "GMV" },
  units_label: { es: "Unidades", en: "Units" },
  season_title: { es: "Calendario de temporadas", en: "Season calendar" },
  season_dates_tbd: { es: "Fechas por confirmar", en: "Dates to be confirmed" },
  season_already_passed: { es: "Ya pasó", en: "Already passed" },
  // {days} filled in by t()'s simple {placeholder} substitution.
  season_window_open: { es: "Ventana abierta, faltan {days} días", en: "Window open, {days} days left" },
  season_starts_in: { es: "Empieza en {days} días", en: "Starts in {days} days" },
  settings_title: { es: "Ajustes", en: "Settings" },
  settings_coming_soon: {
    es: "La edición de ajustes llega en una fase futura. Por ahora, edita config/settings.yaml.",
    en: "Editing settings from here arrives in a later phase. For now, edit config/settings.yaml.",
  },
  credits_title: { es: "Créditos de FastMoss", en: "FastMoss credits" },
  credits_remaining: { es: "Restantes", en: "Remaining" },
  credits_used_month: { es: "Usados este mes", en: "Used this month" },
  credits_used_week: { es: "Esta semana", en: "This week" },
  weights_version: { es: "Versión de pesos", en: "Weights version" },
  last_run: { es: "Última corrida", en: "Last run" },
  sample_data_banner: {
    es: "Datos de muestra: esto no es real todavía (Fase 0a)",
    en: "Sample data -- this isn't real yet (Phase 0a)",
  },
  no_data: { es: "No hay datos disponibles.", en: "No data available." },
  // "Buscar cuenta" (account search Worker), added 2026-10-15.
  buscar_cuenta_title: { es: "Buscar cuenta", en: "Search account" },
  search_button: { es: "Buscar", en: "Search" },
  searching: { es: "Buscando...", en: "Searching..." },
  view_profile_tiktok: { es: "Ver perfil en TikTok", en: "View profile on TikTok" },
  account_not_found: { es: "No encontramos esta cuenta.", en: "We couldn't find this account." },
  search_failed: { es: "Algo salió mal. Intenta de nuevo.", en: "Something went wrong. Try again." },
  enter_password_prompt: { es: "Ingresa la contraseña para buscar cuentas:", en: "Enter the password to search accounts:" },
  wrong_password: { es: "Contraseña incorrecta.", en: "Wrong password." },
  followers_label: { es: "Seguidores", en: "Followers" },
  sales_28d_label: { es: "Ventas (28 días)", en: "Sales (28 days)" },
  videos_posted_label: { es: "Videos publicados", en: "Videos posted" },
  avg_views_label: { es: "Vistas promedio", en: "Avg views" },
  top_categories_label: { es: "Categorías principales", en: "Top categories" },
  audience_label: { es: "Audiencia", en: "Audience" },
  top_videos_label: { es: "Videos que más venden", en: "Top-selling videos" },
  top_products_label: { es: "Productos que más vende", en: "Top-selling products" },
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
  document.documentElement.lang = locale(lang);
}

export function t(key: string, lang: Lang, vars?: Record<string, string | number>): string {
  const entry = dict[key];
  let text = entry ? entry[lang] : key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}
