# Product Radar: full design review (2026-10-16)

Written from screenshots of every route at 390px and 1440px (local build of
`main` at b0bace1) plus Ryan's live-site screenshots. This is the single
source of truth for the next design pass. It **consolidates and supersedes**
the redesign requests already queued in the main session (Lives que venden
cards, compact cards/scrolling, Más page, charts, Plan cards, sales logging);
where they overlap, follow this file.

Goal: the site should feel like a finished app a creator would pay for, not a
data dump. Every screen answers one question fast, on a phone first.

---

## 0. The 12 things that matter most (do these first, in order)

1. **Mobile navigation is broken.** At 390px the top tab row overflows: "Más"
   is off-screen and you have to scroll the tab bar sideways. Replace with a
   fixed **bottom tab bar** on phones (icon + label: Hoy, Videos, En vivo,
   Mis Productos, Más), top bar on desktop. Badge counts where useful
   (pending requests on Mis Productos).
2. **Pages are absurdly long.** Measured full-page height at 390px:
   Videos → Esta semana **153,425px (~180 screens)**, Todos 18,079px, Hoy
   10,562px. Targets below (section 2).
3. **One product card component everywhere** (Hoy, Videos, En vivo Plan,
   Lives que venden products, Mis Productos, Más lists). Today there are at
   least 5 different card styles, several not clickable.
4. **Product detail opens as a sheet/modal**, never inline in the list
   (the inline detail panel is a big part of the scroll length on desktop).
5. **Broken images** must never show alt text. The Hoy hero currently shows
   the alt text as a blue underlined link ("Comfrt | Teddy Full Zip
   Jacket..."), Lives que venden shows "Waffl"/"YEORE" fragments, and the
   Hoy "próximo live" thumbnails are empty boxes. All images through the
   `/img` proxy or local cache, plus a designed placeholder (neutral tile +
   category icon; host initials for people).
6. **Too many buttons per card.** The Hoy hero has 7 buttons. Max 2 visible
   actions per card; the rest go in a "⋯" menu (section 3.1).
7. **No developer words or raw keys in the UI.** Seen live: `beauty_hair`,
   `other`, `seasonal`, `womens_clothing`, `activewear`, `pajamas`
   (lowercase), ISO dates `2026-11-01 → 2026-12-02`, "plan quota",
   "top-up", "runs". Add a test that scans rendered text for `_` keys and
   ISO dates.
8. **Spanish accents are missing** in config-sourced labels: "Ano Nuevo",
   "Dia de las Madres", "Graduacion", "San Valentin", "asi de facil".
   Fix at the source (`config/seasons.yaml`, hooks) and add a test.
9. **Lead every data screen with the answer in words**, then the chart
   (best times, horarios, Mi Dinero). Charts support; they don't replace the
   sentence.
10. **Empty states are walls of empty boxes** (Mi Dinero shows 7 empty cards
    and a chart of $0.00 bars; Mis Productos shows 6 zero counters + a raw
    form). Replace with one friendly onboarding card per page (section 5).
11. **Native, unstyled controls** leak through: "Guardar meta" and "Agregar"
    are default gray browser buttons; the date input is browser default.
    Style every control through the design system.
12. **Product titles are raw seller titles** ("MRH 10"12 "14" -Inch Twin,
    Full, Queen, King,Luxury Hybrid Mattress -Memory Foamand"). Show a clean
    short name (brand + 3-5 words, e.g. "MRH Colchón híbrido 14''") on cards;
    full title only in the detail sheet.

---

## 1. Design system (fix once, applies everywhere)

The look (cream paper, espresso text, terracotta accent, Fraunces + Karla) is
right. What's missing is a consistent system; `styles.css` is ~3,000 lines of
per-page CSS. Consolidate into components with tokens:

- **Tokens**: keep `--bg/--surface/--text/--accent/...`. Add a spacing scale
  (4, 8, 12, 16, 24, 32), type scale (12, 14, 16, 20, 24, 32), radius (8, 12,
  16, pill), elevation (none / card / sheet). No ad-hoc pixel values.
- **Components** (one implementation each, used by every view):
  `ProductCard` (compact + hero variants), `LiveCard`, `CreatorHeader`,
  `StatRow` (big number + small label), `Chip` (filter) and `Badge` (status),
  `Button` (primary, secondary, ghost, icon), `OverflowMenu`, `Sheet`
  (bottom sheet on phone, centered modal on desktop), `SegmentedControl`,
  `SectionHeader` (title + "Ver todo"), `EmptyState`, `Skeleton`, `Toast`,
  `AnswerCard` (big sentence + reason + sample note), `BarChart`.
- **Typography**: Fraunces only for page titles and the hero product name.
  Everything else Karla. Card titles 15-16px/600, meta 13px, never below
  12px (several captions today are ~10px and unreadable).
- **Color meaning, used consistently**:
  green = money/earnings and "Vale la pena", amber = "Tal vez"/warnings,
  red-ish = "Pásalo"/"Muy lleno", purple = "Pocas latinas", neutral sand =
  season/info. Today chips mix these meanings.
- **Numbers**: `5.3K vendidos`, `$121K`, `2.0%`; no "999%+" (show
  "Subiendo fuerte" with an arrow instead once growth > 300%). Times in
  12-hour format ("8-10 PM"), always ET-labeled once per page.
- **Loading**: skeleton cards instead of blank space while JSON loads.
- **Tap targets** ≥ 44px; focus rings visible; images have real alt text.

## 1b. Desktop and mobile versions (Ryan's request)

Two deliberately designed layouts, chosen automatically, with a manual
override:
- **Auto-detect** on load and on resize/rotate: phone layout below 768px
  OR on a touch-primary device (`(pointer: coarse)`), desktop layout at
  ≥1024px with a fine pointer, tablet in between gets the phone layout with
  2-3 grid columns. Apply as a class on `<html>` (`layout-mobile` /
  `layout-desktop`) so components can render differently, not just shrink.
- **Phone layout**: bottom tab bar, bottom sheets, 2-column compact grids,
  sticky sub-tabs, big tap targets, swipeable horizontal rows.
- **Desktop layout**: top nav (or left sidebar with the same 5 sections),
  4-column grids, centered modals, hover states, product detail can show
  photo + details side by side.
- **Manual override in Ajustes → "Vista"**: Automática (default) · Celular ·
  Computadora. Saved per device in localStorage (not synced: each device
  keeps its own choice), applied before first paint to avoid a flash.
- Also a small "Cambiar a vista de computadora/celular" link in the footer
  as a backup if the layout ever looks wrong.
- Tests: the detection function is pure (width, pointer, override) →
  layout, with unit tests; Playwright screenshots of every route in both
  layouts.

## 2. Layout and scroll targets

- **Phones**: 2-column grid of compact product cards. First screen shows the
  page title, one summary line, and at least 4 products.
- **Desktop**: 4 columns ≥1280px, 3 ≥1000px; content max 1200px. No
  single narrow column with empty space beside it.
- **Paging**: 12 cards then "Ver más (N)". "Everything else this week"
  starts collapsed by category ("Fajas · 28 ▸").
- **Sticky**: page sub-tabs + filter chips stick under the header; "↑ Arriba"
  button after 2 screens.
- **Targets** (390px, before "Ver más"): Hoy ≤ 3 screens, Esta semana ≤ 4,
  Todos ≤ 4, every other page ≤ 3. Add a Playwright check that fails if a
  route exceeds its height budget.
- **Global header**: the "Solo en este teléfono: toca para conectar" banner
  on every page is loud. Replace with a small cloud icon in the header
  (green check = synced, amber dot = not connected → tap opens connect sheet).

## 3. Page by page

### 3.1 Hoy

What works: clear "Grábalo primero" hero, strong earnings line, hashtags with
copy.

Fix:
- Order: (1) goal card, (2) hero pick, (3) "También te conviene" row (6
  compact cards, horizontal scroll on phone), (4) "Tu próximo live" mini
  card, (5) next season banner. Today the live card sits above the hero and
  its photos are empty.
- **Goal card empty state**: replace input + gray button with quick chips
  "$250 · $500 · $1,000 · Otra" and one line "¿Cuánto quieres ganar este
  mes?". Once set: progress ring, "Vas al ritmo de $X", "Te faltan N ventas
  de [producto]", and the "+ Venta" button.
- **Hero**: photo left / details right on desktop, photo top on phone (max
  320px tall, not 600). Show: clean name, Ganas $X/venta, 1 reason line,
  1 hook quote, best time to post (1 line), hashtags (collapsed to 4 +
  "Copiar"). Actions: primary "Ver en TikTok Shop", secondary "Ya lo
  tengo", "⋯" → Pedir muestra, Marcar grabado, Guardar, No me interesa,
  Ver videos que venden, Plan de tomas.
- Remove repeated stats from the hero that the verdict already covers
  ("~19.8 ventas por creadora", "21 ventas = $100", "Estimado para ti")
  → move to detail sheet.
- Season banner: one line with the date that matters ("Black Friday: empieza
  a grabar antes del 1 nov") and a link to Temporadas.

### 3.2 Videos → Esta semana

- "Combina y gana más" → one compact horizontal row of pair cards (two
  photos side by side + "Ganas $10.90 juntos"), collapsed under a
  section header, not a text block with two full product titles.
- Todo / Moda / Hogar → chips, not full-width blocks.
- Cards: compact `ProductCard`. Lines: name (2 lines), "Ganas $X",
  "5.3K vendidos ↑", verdict badge. Max 2 tags. Buttons: "Ya lo tengo" +
  "⋯".
- Detail: sheet with photo carousel, all stats, videos that sell, hashtags,
  hooks, best times, shot list, actions.
- Fix the desktop overlap seen in the 1440px capture (a blank panel draws
  over the grid where the sticky detail panel used to be).

### 3.3 Videos → Todos

- Same grid/card as Esta semana. Search box + filter chips (category) +
  sort dropdown (Recomendado, Más vendidos, Más ganancia por venta,
  Subiendo, Pocas latinas). Paging 24 at a time.
- "Ocultar los que ya tengo" toggle stays.

### 3.4 Videos → Mejores horas (Ryan: "needs a major renovation")

Current page is a long list of identical cards, raw keys (`activewear`,
`beauty_hair`, `other`, `seasonal`), "not enough videos" cards for categories
she doesn't track, and the live section repeats "Mon/Tue 8-10 PM" for every
fashion category.
- Top: group dropdown (Moda / Zapatos / Muebles / Hogar / Mascotas, plus
  "Todas"). Only her tracked categories exist.
- `AnswerCard`: "Mejor momento para publicar videos de Moda: miércoles
  8-10 PM" + reason ("los 30 videos que más vendieron se publicaron más a
  esta hora") + second-best option + sample note.
- Two bar charts: by day, by 2-hour block (12-hour labels), best bar
  highlighted, values on bars, gray "sin datos".
- Organic vs ads toggle only if both have ≥30 samples; otherwise a note.
- Live times live in En vivo → Horarios only (don't duplicate here; link).
- Sanity: "Moda: 12-2 AM" as the best posting time is suspicious; verify the
  timezone conversion and minimum-samples rule before showing it.

### 3.5 En vivo → Plan

- Use the shared `ProductCard` (tappable, same detail sheet). Add the show
  order number (1, 2, 3...), one talking point, "Vendió N en lives top"
  when true, and "Quitar del plan".
- Header: big answer "Tu próximo live: lunes 8-10 PM · Fajas" + "Duran ~2 h
  los que venden" + buttons "Guardar plan" and "Copiar lista".
- Owned items: one "Ya lo tienes" badge (today it's said twice), actions
  "+ Venta" and "Abrir en TikTok Shop".

### 3.6 En vivo → Lives que venden

- Only investigated lives (24 now). Remove leftover uninvestigated cards.
- `LiveCard`: `CreatorHeader` (64px avatar, @handle → TikTok, followers,
  28-day sales, "Vende sobre todo: Moda"), `StatRow` (Viewers · Ventas ·
  Conversión · Duración), date/time, horizontal strip of product cards
  (~120px photo, name, price, units in that live).
- Tap → full live page: every product (shared cards with actions), "Qué
  copiar" (price range that sold, best seller, length), host summary.
- Filters (Todo · Moda · Zapatos · Hogar · Mascotas) + sort (Más ventas ·
  Mejor conversión · Más reciente). 2 columns on desktop.
- "Productos que más se venden en lives": grid of shared cards with total
  live units and number of lives.
- No timeline section (data is empty); don't render empty charts.

### 3.7 En vivo → Horarios

- Replace the tall day × hour grid (tiny "0h/2h" labels, no legend, darkest
  cell not the outlined "best") with the same `AnswerCard` + 2 bar charts as
  Mejores horas. One group at a time via the dropdown. Fits one phone screen.

### 3.8 Mis Productos

- Header summary as one row of 4 stats that matter: Por grabar · Publicados ·
  Vendiendo · Ganado este mes. (Six zero counters in two uneven rows today.)
- Tabs: Tengo · Solicitudes (Pendientes/Aprobadas/Rechazadas) · Guardados
  (♡, moved from Más) · Historial de ventas.
- Item rows: photo, clean name, status badge, next action button (e.g.
  "Marcar grabado", "+ Venta"), days since received if waiting.
- "+ Agregar producto" button → sheet (paste TikTok Shop link or name,
  photo, commission, date). Remove the always-visible raw form.
- Empty state: illustration-free card: "Aquí van tus muestras y productos.
  Toca **Ya lo tengo** en cualquier producto para empezar." + button to
  Videos.

### 3.9 Mi Dinero

- Empty state: one card "Registra tu primera venta para ver tus ganancias"
  + "+ Venta". Hide all other cards until there's at least one sale.
- With data: big number "Este mes $X" + goal progress, then by source
  (Video / Live / Vitrina), monthly bars (only months with data, max 6),
  top products, $/hora, pendiente vs pagado, free-sample value, approval
  rate. Each card has a one-line takeaway ("Los lives te pagan 2x más por
  hora que los videos").

### 3.10 Más

- Grid of cards with icon, name, one-line description, live preview value
  (Mi Dinero, Cuentas = Buscar + Comparar merged, Tiendas para colaborar,
  Temporadas, Ajustes). Credits only inside Ajustes → Admin (collapsed).

### 3.11 Tiendas para colaborar (was "Shops to reach out to")

- Filter to her tracked categories (today: crochet flowers, a "safe box for
  money" book safe, both off-target).
- **Signature is hardcoded "Roxie, @roxm___"**: use the profile's name and
  handle (multi-user readiness).
- Message: shorter, TikTok-DM tone, ES + EN versions, editable before copy.
- Replace "Ver en FastMoss" (needs a FastMoss login; customers won't have
  one) with "Abrir tienda en TikTok" / "Ver producto en TikTok Shop".
- Card: shop logo/initials, commission, # creators, best product photo,
  "Ya la contacté" toggle (synced) so she tracks outreach.

### 3.12 Cuentas (Buscar + Comparar)

- Empty page today (just an input). Add: saved accounts grid, recent
  searches, and a short "Para qué sirve" line. Compare = select 2-4 saved.

### 3.13 Temporadas (was "Season")

- Timeline, not a list: "Ahora", "Próximo", "Más adelante". Each event:
  name with accents, "Empieza a grabar: 25 oct" (human date), what sells
  (her category names, with 3 product thumbnails from this week), and a
  countdown.
- Remove raw keys and the categories she doesn't sell (beauty).

### 3.14 Ajustes / Ocultos

- Ajustes: language, conexión/sincronización (status + reconnect), mis
  categorías, meta mensual, Productos ocultos (count → list with
  "Mostrar de nuevo"), ayuda, Admin (collapsed: créditos, última
  actualización de datos).

## 4. Worth adding (in priority order)

1. **Installable app (PWA)**: manifest, icon, splash, "Agregar a la
   pantalla de inicio" prompt, offline cache of the last week's data. She
   uses it on her phone daily; this makes it feel like an app.
2. **"Esta semana para ti" plan**: a simple content calendar Mon-Sun with
   suggested slots (from best times) where she drags/assigns picks; ties
   into the weekly video mini-goal.
3. **Monday recap card on Hoy**: "La semana pasada: 4 videos, 12 ventas,
   $58 (63% de tu meta)" + "Nuevo esta semana: 6 productos".
4. **What changed**: "Nuevos en el top", "Subiendo rápido", "Salieron del
   top" badges and a filter.
5. **Onboarding (first run, required for selling it later)**: name/handle,
   categories, monthly goal, language, connect. 4 short steps.
6. **Global search** (header icon) across products, lives, Mis Productos.
7. **Reminders** (once PWA): request waiting 7+ days, sample received but
   not filmed, live planned today.
8. **Share**: "Copiar resumen" of a product (name, link, hashtags, hook) to
   paste into notes or send to Ari-like collaborators (no names hardcoded).
9. **Dark mode** (later; tokens make it cheap).

## 5. Copy and tone

- Spanish first, warm and short. One idea per line. Use "tú".
- Replace jargon: "conversión" → "de cada 100 que ven, N compran"
  in helper text; "GMV" never shown.
- Every number has a label the first time it appears on a page.
- Verdict reasons stay one line ("Paga poco: solo vale si vende mucho").

## 6. Definition of done for this pass

- Screenshots of every route at 390px and 1440px attached to the PR/commit
  notes, before and after.
- Height budgets in section 2 pass (automated check).
- No raw keys, ISO dates, missing accents, or developer words (automated
  text scan in ES and EN).
- Every product card anywhere opens the same detail sheet.
- No broken-image alt text anywhere (automated check: every `img` has a
  loaded image or the placeholder).
- Tests + CI green. Roxie's synced data untouched.
