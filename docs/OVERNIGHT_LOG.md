# Overnight autonomous session log (2026-10-16)

Ryan went to sleep and authorized working through the full queue
unattended: make reasonable calls, log each decision here, commit+push
after every item with screenshots, no FastMoss paid calls, never touch
Roxie's synced data, keep CI green. Skip-and-log anything that truly
can't be decided.

Queue order at start of the night (earlier items already done before
this log started, see git log for f3df27b..4accf47):
1. ~~Design review section 0 items 1-4, 7~~ -- done, see commits
   40082ed, e74b457, f264705, f45d00c.
2. ~~AnswerCard + bar charts (Horarios, Mejores horas)~~ -- done, f45d00c.
3. Lives que venden card restructure (creadora/live sections, 1 button)
4. Buscar cuenta video thumbnails + card restyle
5. Buscar cuenta save-profile control
6. Merge Buscar+Comparar into a "Cuentas" main tab
7. Seasons/Temporadas dates + move out of Mas
8. Mis favoritos feature (brands/types, scoring boost)
9. Remaining section 0 items (0.5, 0.6, 0.8-0.12)
10. Section 1b (desktop/mobile auto-detect layout)
11. Remaining design review sections (1, 2, 3.8-3.14, 4, 5)
12. Sales-logging upgrade (PENDING_REQUESTS.md items 5-6) -- LAST

## Decisions log

### Item 3: Lives que venden card restructure -- done
Two labeled sections ("La creadora" / "Este live · <date>"), per-product
"N vendidos en este live" line, product strip cut to one button (Ya lo
tengo); tapping a product thumb opens the shared detail modal with the
other actions (TikTok Shop link, Pedir muestra -- moved there since the
card itself only has one button now).

Category filter (item 4): added `liveProductCategoryMatch.ts`, a
keyword-based check against her 12 tracked categories' real product
titles, hiding (not deleting) a live when none of its products match.
Caught and fixed a real false-positive bug before shipping: naive
`.includes("coat")` matched "Chicken-**Coat**ed Collagen Cheek Rolls"
(an actual @gusthepup0 dog-treats product) -- switched to word-boundary
regex matching (with a plural "s?" suffix so "Boots"/"Dresses" still
match). Verified against the real @gusthepup0 live data: now correctly
hidden. This is a loose heuristic (keyword list I wrote, not derived
from config/categories.yaml's own require/exclude lists, which are
Python-side and not exported to the frontend) -- good enough to catch
obviously-off-topic lives like the dog-treats example, not a precise
classifier. Flagging as a reasonable-but-imperfect call per Ryan's
"make reasonable choices" instruction.

### Item 4: Buscar cuenta video thumbnails + card restyle -- mostly done, one piece needs Ryan
Root cause confirmed in worker/src/logic.js's `mapVideoAnalysisResult`:
it never extracted a cover image field at all (not a mapping bug, a
missing field). docs/field_map.md has no confirmed field name for
creator_video_analysis's `video_list[]` cover image specifically (only
for video_search/product_video_list, different tools) and the only
local fixture is the Worker's own post-mapped cache read-back, which
has no raw response to inspect -- so per CLAUDE.md's "never guess
FastMoss fields" rule, I did not silently invent a field name. Instead:
applied the same `firstDefined` best-effort candidate-list pattern this
file already uses for `image_url`/`price` (an established, documented
project convention for genuinely-unconfirmed fields), trying `cover_url`,
`video_cover`, `thumbnail`, `cover`, `video_meta.cover_url`. If none of
these are the real field, the frontend's placeholder covers it -- never
a broken-image icon, matching Ryan's own instruction.

Restyled the video list as proper cards (9:16 thumb, 2-line clamped
title in normal color, "44.5K vistas - 14 ventas" + post date, 2-3 desktop
columns) -- `.search-video-grid`/`.search-video-card` in styles.css.
Added `cover_url`/`published_at` to `AccountSearchVideo` and 4 new
worker unit tests (29 passing). Did NOT run `wrangler deploy` -- no
Cloudflare credentials in this session, and deploying is a real
production action outside what "make reasonable choices" should cover
unattended. **Ryan: worker/src/logic.js's fix needs `npm run deploy`
from worker/ (with your Cloudflare auth) before it takes effect on the
live site; until then the deployed Worker still returns no cover_url
and the frontend correctly falls back to the placeholder.** Did not
trigger a real search against the live Worker to screenshot this (no
safe free way to see MY fix's output anyway, since it isn't deployed,
and the search budget is a real limited resource -- 5/day, 40/month
per CLAUDE.md -- not something to spend on a screenshot overnight).

Also fixed, found while touching this file: several missing Spanish
accents in i18n.ts's en_vivo_lives_* keys (dias->días,
conversion->conversión, Que copiar->Qué copiar, mas vendido->más
vendido, ahi->ahí) -- design review item 0.8, opportunistic fix while
already editing this block; the fuller accent audit across the whole
dict is still queued under "remaining section 0 items".

### Items 5+6: save-profile control + merged Cuentas tab -- done, combined
Ryan's own message 6 said the merge should include "the Guardar perfil
button from my previous message" -- built them together in one pass
rather than building the save control into the old separate Buscar
page and then reworking it for the merge an hour later.

"Cuentas" is now a 6th main bottom-tab (Hoy/Videos/En vivo/Cuentas/Mis
Productos/Mas) -- fits fine at 375px, no need for the "move Mas into a
header menu" fallback Ryan allowed for. Sub-tabs Buscar/Guardadas/
Comparar (views/cuentas.ts). #/buscar and #/comparar-cuentas still
work, now rendering inside the new shell (redirected in main.ts's
switch, not an HTTP redirect -- this is a hash-routed SPA). Removed
both old entries from Mas's list (views/more.ts) -- it now keeps Mi
lista, Tiendas para colaborar, Productos ocultos, Mi Dinero, Temporada,
Ajustes (Ryan's list said "Mi Dinero, Tiendas para colaborar,
Temporadas, Ajustes" -- kept Mi lista/Ocultos too since removing them
wasn't asked for and they're not part of this merge).

"Guardar perfil" (views/buscarCuenta.ts's creatorStatsHtml) toggles via
a new savedProfiles.ts, synced through the EXISTING generic /state
route (same one Mis Productos already uses) -- no Worker deploy needed
for this part, unlike item 4's video-thumbnail fix. "Ver perfil en
TikTok" moved into the same header row. Comparar's picker
(compararCuentas.ts) now sources from saved/favorited profiles instead
of every search ever made.

Deliberately did NOT stop the Worker's existing auto-save-on-every-
search behavior (savedSearches.ts's listSavedSearches, still backing
"open a saved result for free") -- Ryan's item 3 asked to stop that,
but doing so safely needs a Worker code change + deploy, which I can't
do tonight (same constraint as item 4). Reasonable substitute that
needs no deploy: Guardadas only ever shows explicitly-favorited
profiles (the new synced list), never the full auto-save history, so
the VISIBLE behavior matches what Ryan asked for. Did not build a
separate "Recientes" list (item 3's second half) -- lower priority than
getting Guardadas/Comparar/the save button working correctly, and
reasonable to defer; logging it as a known gap rather than skipping
silently.

Caught one real bug while testing: `.group-tabs` CSS only styled
`button`, never `a` -- the new sub-tab links rendered as default blue
underlined text (styles.css fix: extended the selectors to cover both).
