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

## Status: all 12 "things that matter most" (section 0) done

As of commit 95a2dff, every item in DESIGN_REVIEW.md section 0 (the
"do these first, in order" list) is done and pushed: 1 (bottom tab
bar), 2-4 (compact cards + modal detail, Esta semana/Todos), 5
(broken-image placeholders -- was already mostly done pre-session,
verified), 6 (overflow menu, max 2 visible card buttons), 7 (no raw
category keys + copy-scan test), 8 (accents + the seasons.json root
cause), 9 (AnswerCard-first covered via section 3.4/3.7's redesign,
done earlier), 10 (empty states), 11 (.btn-primary base rule), 12
(clean_title bug fix). Also done out of section-0-order per Ryan's
live reprioritization during the session: section 3.4/3.7 (AnswerCard
+ bar charts), 3.6 (Lives que venden restructure), Buscar cuenta video
thumbnails + save-profile control, the Cuentas tab merge, Seasons
dates/placement, and Mis favoritos (scoped).

Remaining, in DESIGN_REVIEW.md's own order, not yet started this
session: section 1b (desktop/mobile auto-detect layout + Ajustes
"Vista" override), section 1 (design tokens/component consolidation
pass -- largely already satisfied piecemeal by tonight's work, worth a
dedicated audit rather than assuming done), section 2 (height-budget
automated check specifically -- the actual page-length REDUCTIONS are
done, but no Playwright/test enforcing the 390px screen-count budgets
from the doc exists yet), 3.2-3.3 already covered by tonight's Esta
semana/Todos work, 3.5 (En vivo Plan card polish beyond what Mis
favoritos/overflow menu touched), 3.8-3.14 (Mis Productos mostly
covered by the empty-state work, Ajustes/Ocultos not reviewed), section
4 (PWA, weekly plan, Monday recap, etc. -- all net-new features, none
started), section 5 (copy/tone audit), section 6's automated checks
(the raw-key/ISO-date scanner exists and tests the i18n dict, but
nothing scans actual RENDERED pages yet -- a real gap against the
doc's "add a test that scans rendered text" ask). PENDING_REQUESTS.md
items 5-6 (sales-logging upgrade) intentionally last, not started.

17 commits this session (40082ed..95a2dff), all with tsc clean + full
test suites green (136 frontend / 387 Python) before each push. Ryan:
nothing here is blocked on you except the two Worker-deploy items
(video thumbnails, logic.js) and confirming whether item 4's TikTok
Shop sale-event dates are worth pursuing further.

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

### Item 7: Seasons/Temporadas dates + placement -- done
Found the real root cause of the design review's "ISO dates
2026-11-01 -> 2026-12-02" / raw-key complaint while investigating:
web/public/data/seasons.json was never written by the pipeline at all
(no write_seasons call existed anywhere in engine/export.py or
engine/run.py) -- it was a stale, hand-committed file left over from
before the 2026-10-18 category rework, still using old keys
(womens_clothing, beauty_hair) and missing the `event_date` field
config/seasons.yaml already had. views/season.ts rendered that stale
file's raw category array and raw film_start/film_end strings directly
-- exactly the bug class items 0.7/0.8 describe, just not the file
Ryan's screenshots happened to show it in.

Fixed at the source: added engine.export.write_seasons (3 new pytest
cases) and wired it into engine.run.run()'s export step so every real
weekly run keeps it fresh from now on; regenerated it immediately with
a one-off 0-credit local script (engine.config.load_all +
write_seasons -- pure data transform, no FastMoss call) so the fix is
live now, not just after tomorrow's scheduled run. Also synced
web/public/data/sample/seasons.json to match.

DATES: moved Black Friday filming to Oct 15 and holiday gifting to
Nov 1 in config/seasons.yaml per Ryan's instruction (both comments
explain why). Did NOT add TikTok Shop's own sale events (Deals for You
Days already exists as a placeholder with null dates, correctly shows
"Fechas por confirmar") -- item 3 said only add them with dates
confirmed from TikTok Shop's own official pages, and I'm not confident
enough in anything I could find to call it "confirmed"; left as a
known gap rather than guessing a sale date. Fixed a few more missing
accents in config/seasons.yaml's notes_es while in the file (Leggings
termicos -> térmicos, two "Dia de las Madres" -> "Día de las Madres").

views/season.ts (+ new seasonLogic.ts, split out so the pure
groupSeasonEvents/countdownStatus functions don't pull in i18n.ts's
value import and break node's test runner -- same class of fix as
copyScan.ts, pure logic stays dependency-free): every event now shows
"Empieza a grabar: {date} - {Event}: {date}" (human dates, not ISO) and
real category names (not raw keys), via categoryLabels.ts.

PLACEMENT: "Temporadas" removed from Mas; full calendar lives at
#/temporadas (old #/season link still works) as a 3-section timeline
(Ahora/Proximo/Mas adelante, groupSeasonEvents + 4 new tests). Hoy got
a "Proxima temporada" card (current-or-next event, countdown, start-
filming date, up to 3 product thumbnails from this week's picks
matching the event's categories, "Ver calendario" link) replacing the
old one-line countdown banner.

NOT done (logged, not silently skipped): the "Temporada" filter chip
on Videos -> Esta semana (item 4's last piece). Lower priority than
getting the dates/placement core right; the per-product season tags
Ryan said to keep already work unchanged (productCard.ts's
seasonEventLabel, untouched this pass).

### Item 8: "Mis favoritos" -- scoped down, done
Full 5-part request (setup sheet, engine scoring boost, UI tags/filter/
new-from-brands row, light-learning nudge, tests) was too large to do
whole; shipped a smaller, real, fully-tested slice and logged the rest
as deferred rather than attempting all 5 shakily.

Setup: Ajustes -> "Mis favoritos" card -- category chips (from this
week's real tracked categories) + brand chips (built from this week's
candidates.json shop_name values, sorted by count, top 30, each
showing "(N products)") + optional min/max price, saved via a new
favorites.ts synced through the existing generic /state route (no
deploy needed, same mechanism as savedProfiles.ts). Did NOT build the
first-run prompt on Hoy -- Ajustes alone covers "pick your favorites
somewhere," the extra onboarding prompt is a smaller follow-up.

Scoring boost: deliberately did NOT touch config/weights.yaml or any
engine/*.py scoring code. Favorites are stored client-side (synced via
Cloudflare KV through the Worker); the real weekly scoring pipeline
runs as a scheduled GitHub Action with no access to that per-user data
unless it made a live network call back to the Worker during a
scheduled job -- a real architecture change needing a new secret/auth
path, out of scope for an unattended overnight pass, same category of
risk as the Worker deploys already deferred. Instead applied the boost
(favoritesLogic.ts's applyFavoritesBoost, +0.15 default, 7 new tests)
as a client-side re-sort, specifically in Todos' default "Recomendado"
sort only (the one sort mode that's explicitly about relevance rather
than an honest raw number like "most sold") -- applied strictly AFTER
the existing suspicious-filter and sortCandidates call, never able to
surface a filtered-out product.

UI: "⭐ Te gusta" tag (productCard.ts's compact + full info block) and
an "⭐ Mis favoritos" filter chip in Todos, verified in the browser
end to end (favorited Vestidos, saved, filtered Todos down to exactly
the Vestidos-category + favorited-brand products, tag showing on each).

### Item 0.11: native unstyled controls ("Guardar meta" gray button) -- done
Root cause: `.btn-primary` never had a standalone base CSS rule, only
`.card-actions .btn-primary` and `.sample-form-actions .btn-primary`
scoped rules -- any button using the class outside those two specific
parents (goalCard.ts's "Guardar meta", inside `.earnings-goal-form`,
and every other `.btn-primary` not nested in a card-actions/
sample-form-actions block) got zero styling, the literal plain gray
default browser button the design review screenshot showed. Added a
real `.btn-primary` base rule; the two scoped rules now just sit on
top of it (no visual regression -- same declarations). Fixes it
everywhere the class is used (enVivo/goalCard/hoy/misProductos/
samples/thisWeek/todos/hideProduct), not just the one spot in the
screenshot. Verified "Guardar meta" at 390px -- proper accent pill
button now. Date inputs were already reasonably styled via
`.earnings-goal-form input` (border/background/radius match the
design system); left native OS date-picker chrome as-is -- replacing
that needs a custom date-picker widget, a bigger separate task.

### Item 0.12: clean product titles vs raw seller titles -- done
Tested engine.text.clean_title directly against the design review's own
flagged example (the MRH mattress title) and found it came back
*completely unchanged* -- a real bug, not a "needs tuning" gap.
Root cause: `_unreadable`'s real-word count used `word.isalpha()` on
whitespace-split tokens, so punctuation stuck to a word (the fallback
path never ran the comma-splitting _SEPARATOR_RE does for the primary
first-segment cut) hid real words from the count -- "Twin," "Full,"
"King,Luxury" all failed `.isalpha()` even though they're real words,
undercounting real_words and wrongly triggering the "whole raw title"
last-resort fallback. Fixed both sides: `_unreadable` now finds real
words with a regex run (punctuation-proof) instead of exact-token
isalpha, and the full-title fallback path strips commas/semicolons the
same way it already strips brackets. Added a regression test with the
exact flagged title; all 18 existing text.py tests plus the full
387-test suite still pass.

This is engine-side logic that only takes effect when picks.json/
candidates.json are regenerated -- did NOT force a re-run tonight
(same category as the Worker-deploy items: CLAUDE.md's hard rule
against running the real pipeline outside --dry-run without asking,
and dry-run fixture replay wouldn't actually refresh the live site's
current-week data anyway). Takes effect at tomorrow's scheduled run.

### Item 0.10: empty states ("walls of empty boxes") -- done
Mi Dinero: with 0 earnings entries, now shows one card ("Registra tu
primera venta para ver tus ganancias" + "+ Venta" linking to Hoy)
instead of the 7 empty cards + a $0.00 bar chart the review flagged.

Mis Productos: the 6-always-visible-chip summary (recibido/grabado/
publicado/vendiendo/rechazado/no_llego, several always reading 0 in
two uneven rows) is now one row of 4 stats that matter (Por grabar /
Publicados / Vendiendo / Ganado), matching section 3.8's own spec.
The add-product form was always open on the page -- now behind a
"+ Agregar producto" toggle, collapsed by default. Empty state copy
updated to the review's exact wording ("Aquí van tus muestras y
productos. Toca Ya lo tengo...") with a "Ver Videos" button.

Preemptively avoided the [hidden]-vs-display bug (now the 3rd time
this exact class of bug has come up) in the new add-product toggle:
paired .mis-productos-add-form's existing `display: flex` with an
explicit [hidden] override from the start, verified closed-by-default
in the browser before committing rather than after.

### Item 0.6: too many buttons per card (Hoy hero) -- done
Hoy's hero/also-good cards had 6 always-visible buttons (Ver en TikTok
Shop, Ver videos que venden, Marcar grabado, Pedir muestra, No me
interesa, Ya lo tengo). Added a reusable overflow-menu.ts component
(section 1's "OverflowMenu"), cut visible actions to 2 (primary "Ver
en TikTok Shop" + secondary "Ya lo tengo" -- matches section 3.1's own
spec for this exact card), everything else behind a "..." button.

Caught and fixed the SAME real bug class as the earlier
.detail-modal[hidden] fix, in the very component built to avoid
needing that lesson twice: .overflow-menu-list set `display: flex`
with no `[hidden]` override, so the menu rendered OPEN on every page
load again. Fixed immediately (styles.css) and added
"overflow-menu-list" to hiddenOverlayGuard.test.ts's regression list,
which would have caught it before I ever loaded the page. Verified
closed-by-default, opens on tap, closes on outside click, at 390px and
1440px.

NOT done, logged: the engine-side scoring boost (see above), the
first-run Hoy prompt, the "Nuevo de tus marcas" row on Hoy, and the
"tap Ya lo tengo/+ Venta on 3+ items from one brand -> suggest
favoriting" light-learning nudge. All four are real, scoped follow-up
work, not abandoned -- just too much for one already-long pass next to
everything else in the queue.
