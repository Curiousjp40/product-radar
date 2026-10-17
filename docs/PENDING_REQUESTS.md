# Pending requests (queued, not yet built)

Verbatim copies of the requests Ryan sent in this session's queue, in the
order he sent them. Not built — see `docs/DESIGN_REVIEW.md`, which the
other linked session (design-review-implementa) says supersedes and
consolidates all of these.

## 1

Add to the redesign: the pages scroll far too long. Fix on Videos (Esta
semana, Todos), En vivo and Mis Productos:
1. Compact cards: square photo (~180px desktop, ~140px phone), 2-line
name, then max 3 short lines: "Ganas $X/venta", units + trend arrow,
verdict chip. Max 2 tags. Everything else (estimate, sales-per-$100,
Spanish note, best time, videos, hashtags) moves to the detail view.
2. Dense grid: 4-5 columns ≥1280px, 3 ≥1000px, 2 on phone (yes, 2 on
phone with compact cards).
3. Detail opens in a modal/bottom sheet, never inline in the list.
4. Paging: show 12 cards, then a "Ver más (N)" button. "Everything else
this week" starts collapsed by category ("Fajas (28) ▸") and each
section expands on tap.
5. "Combine and earn more" becomes one compact row/carousel, collapsed
by default.
6. Sticky header: the tab bar + filter chips stay at the top while
scrolling, plus a small "↑ Arriba" button after scrolling down.
Target: the first screen on a phone shows at least 4 products; the whole
Esta semana page is under ~4 screens tall before "Ver más".
Screenshots at 390px and 1440px showing the page height before/after.

## 2

Redesign the Más page (and merge duplicates). It's an unexplained list.
1. Turn Más into a grid of cards (2 columns phone, 3 desktop). Each card:
icon, clear name, one-line description, and a live preview value.
- Mi Dinero: "Lo que ganaste y tu meta" · "$X este mes de $Y"
- Cuentas (MERGE Buscar + Comparar into one page with Buscar,
Guardadas, Comparar tabs): "Investiga a otras creadoras" ·
"N guardadas"
- Tiendas para colaborar (rename "Shops to reach out to"): "Tiendas
que venden lo tuyo: pide muestras o más comisión" · "N tiendas"
- Temporadas (rename Season): "Fechas que venden más" · "Black Friday
en N días". Also show the next event as a small banner on Hoy.
- Ajustes: language, connect/password + sync status, Ocultos
("Productos que ocultaste", count, undo), help.
2. Move "Mi lista" (saved ♡) into Mis Productos as a "Guardados" tab
and remove it from Más.
3. Hide the FastMoss credits widget from normal users: show it only in
Ajustes → "Admin" (collapsed), for Ryan.
4. Plain Spanish labels first, English when EN is on. No developer
wording anywhere ("runs", "plan quota", "top-up").

## 3

Make every time chart understandable (En vivo → Horarios and Videos →
Mejores horas). Replace the day × hour heat grid with:
1. ANSWER CARD first, in plain words: "Mejor momento para un live de
Moda: martes 8-10 PM" + one reason line ("12 de los 30 lives que más
vendieron empezaron a esa hora") + typical length ("duran ~2 h").
Also "Segunda opción: lunes 8-10 PM".
2. Two simple bar charts below it, not a grid:
- "Por día": Mon-Sun bars (median units), best day highlighted.
- "Por hora": 2-hour blocks labeled "6-8 AM", "8-10 PM" (12-hour
time, ET), best block highlighted.
Value labels on the bars, a one-line caption explaining what the bar
height means, gray "sin datos" for empty days/hours (not a blank cell).
3. Honest sample note: if a group has < 30 lives/videos, show "Pocos
datos: tómalo como pista" in amber.
4. Make the "best" highlight match the actual highest value. (Today the
darkest cell is Tue 8 AM but the outline is on 8 PM.) Pick one clear
rule (median units, min 3 samples per slot) and say it in the caption.
5. Compact: the whole Horarios view fits on one phone screen per group,
dropdown stays at top.
Same answer-card + 2-bar-chart layout for the video best-times page.

## 4

En vivo → Plan: the product cards can't be clicked and use a different,
stripped-down card. Use the SAME shared product card component as
Videos everywhere (Plan, Lives que venden products, Productos que más se
venden en lives, Mis Productos):
- Tap anywhere on the card -> opens the same product detail (modal/
sheet) as Videos, with videos, hashtags, best time, TikTok Shop link.
- Same info lines as Videos (earnings, units + trend, verdict).
- Owned items keep the full card + one "Ya lo tienes" badge (remove the
duplicate "You already have it -- show it live" line). Their buttons
become "+ Venta" and "Abrir en TikTok Shop" instead of "I have this".
- Plan-specific extras stay small: the show-order number (1, 2, 3...),
the one-line talking point, and a "Quitar del plan" option.
If a live product isn't in our product data, open a light detail view
(photo, price, units sold in lives, TikTok Shop link) rather than a
dead card.

## 5

also would like to add things like manual items sold. like for live or
video posted. purchases comission things like that that would also go
into their goal

## 6

Upgrade sales logging (0 credits, synced, counts toward the goal).
1. "+ Venta" sheet becomes a proper form:
- Producto: pick from Mis Productos (search) or type a new one
(adds it to Mis Productos).
- Fuente: Video · Live · Vitrina (showcase) · Otro.
- If Video: optional TikTok video link. If Live: pick or create the
live session (date/time).
- Unidades (default 1), Precio, Comisión % (prefilled from the
product) -> "Ganas" auto-calculated and editable; or enter the
commission $ directly.
- Fecha (default today), Estado: Pendiente / Pagado, Nota.
2. "Registrar un live": one form for a whole live: date/time, length,
viewers (optional), then add each product sold with units ->
creates all the sales at once, linked to that live.
3. "Registrar un video": video link + date posted + product(s); sales
can be added to it later. Marks the product Publicado.
4. Everything feeds the existing goal, pace, milestones and Mi Dinero.
Add to Mi Dinero: earnings by source (Video vs Live vs Vitrina),
best video and best live (by earnings), and a "Historial de ventas"
list with edit/delete.
5. Quick access: "+ Venta" button on Hoy, on every owned product, and
floating on Mis Productos and Mi Dinero.
Tests for the money math (rounding, commission % vs $ entry, pending vs
paid totals). ES/EN, 390px.
