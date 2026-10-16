# FastMoss field map

Filled in during Phase 0 (2026-10-14), from real calls -- fixtures in
`tests/fixtures/fastmoss_*.json`. Tool schemas and credit-tier guesses: see
`docs/fastmoss_tools.json`. Nothing here is guessed; every row below was seen
in an actual response.

## Timezone (Phase 0 acceptance item)

**Confirmed: every FastMoss display timestamp string (`published_at_display`,
and `data/seed/creator_history.json`'s `published_at` column) is China
Standard Time, UTC+8 -- not UTC, not the creator's US local time.**

Proof: `data/seed/creator_history.json`'s row for video `7569620287046667550`
says `published_at: "2025-11-06 22:32:55"`. The live `video_detail_analysis`
call for that same video_id returned `published_at_ts: 1762439575`, which is
`2025-11-06 14:32:55 UTC` -- exactly 8 hours off, i.e. `2025-11-06 22:32:55`
in UTC+8. Matches exactly.

**Implication:** any posting-time analysis (spec section 8.4) must convert
from the raw unix `*_ts` field to the creator's actual local time (US Eastern
or similar) first -- never trust a `*_display` string as already being in a
useful timezone.

## Response envelope (confirmed inconsistent across tools, 2026-10-15)

Some tools' raw MCP response is the payload directly at the top level
(`credit_usage_summary` -> `{"account":..., "balance":..., ...}`); others wrap
it as `{"params": {...the arguments...}, "result": {...the actual
payload...}, "tool_id": "..."}` (`search_category_by_words` does this, and
likely others). `engine/client.py`'s `_unwrap()` detects the wrapper (both
`"result"` and `"tool_id"` present) and strips it so every caller always gets
the real payload at the top level, matching `FixtureReplayClient`'s fixture
shape -- this was a real bug caught by the first live Phase 1 run returning
zero candidates (category resolution silently found nothing because
`resolve_category_ids` was reading `.categories` off the wrapper instead of
`.result.categories`).

## Core product concepts (spec section 4.1 table)

| Concept | Real field(s) | Tool(s) seen on | Notes |
|---|---|---|---|
| product id | `product_id` | product_rank_top_selling, product_search, video linked_products | Large numeric string, not an int. |
| title | `title` | product_rank_top_selling | |
| image | `cover_url` | product_rank_top_selling (product + shop both have their own `cover_url`) | No field literally named "image". |
| category (L1/L2/L3) | `category.l1.{id,name}`, `.l2`, `.l3` | product_rank_top_selling | **English names here.** But `search_category_by_words` (the category-ID lookup tool) only returns **Chinese** `cn_name`/`cn_full_name` + `category_id_level1/2/3` -- no English label on that tool at all. To get an English category name you need a product/ranking response, not the category-search tool. |
| shop name/id | `shop.shop_id`, `shop.shop_name` | product_rank_top_selling | |
| price (current/min/max) | `floor_price`, `ceiling_price`, `price_display` (formatted string e.g. `"$24.00 - 33.00"`) | product_rank_top_selling | No single "price" field -- it's always a floor/ceiling pair since a product can have multiple SKU prices. Video's `linked_products[].current_price` is a single number (one SKU). |
| commission rate | `commission_rate_percent` | product_rank_top_selling, video linked_products | **Percent-integer (15 means 15%), not a 0-1 fraction.** `engine.scoring.earnings_per_sale` expects a fraction -- divide by 100 when mapping. |
| units/GMV: 1d/7d/30d/total | `period_units_sold`/`period_gmv` (for the requested `date_type` window) + `total_units_sold`/`total_gmv` (lifetime) | product_rank_top_selling | No separate 1d/7d/30d fields on this endpoint -- that granularity (and `units_1d`/`units_7d`/`units_30d` in `engine.models.ProductSnapshot`) has to come from summing `product_sales_trend`'s `daily_trend`, or from a `period_summary.period_gmv`/`period_units_sold` call with the matching `time_range_days`. |
| growth rate | `units_sold_growth_rate_percent` | product_rank_top_selling | Percent number, unbounded -- saw values from -41.76 to 6300 (new/tiny-denominator products spike hugely). Don't clamp without checking the spec's own intent. |
| rank position | *(none -- implicit)* | product_rank_top_selling | No explicit rank field. Rank = 1-based position in the returned `list`, which is already sorted by whatever `orderby` was requested. |
| creators/videos/lives promoting (saturation inputs) | `period_summary.linked_creator_count`, `.linked_video_count`, `.linked_live_count` | **product_sales_trend** (NOT product_rank_top_selling) | This is the one FastMoss concept that lives on a different tool than you'd expect -- `creator_count` for section 6.3/6.5 comes from here. |
| daily units series (trend) | `daily_trend[].date` (`YYYY-MM-DD`), `.daily_units_sold`, `.daily_gmv` | product_sales_trend | Includes *today* (the partial/incomplete day), unlike the ranking endpoints which reject the current period. |
| rating, reviews | `product_rating` (e.g. `4.2`) | video_detail_analysis's `linked_products[].product` | Not present on product_rank_top_selling or product_sales_trend. Review *count* not seen yet -- likely `product_review_list` (not called this phase; budget-conscious). |
| delisted flag | `is_off_shelf` (boolean) | product_rank_top_selling, video_detail_analysis | Maps directly to `engine.models.Product.delisted`. |
| launch/first-listed date | `launch_date` (`YYYY-MM-DD`) + `launch_time` (unix) | product_rank_top_selling | Redundant pair; use `launch_time` for math, `launch_date` for display. |

## Creator concepts (section 6.6, 6.11, 6.13)

| Concept | Real field(s) | Tool(s) seen on | Notes |
|---|---|---|---|
| creator UID | `uid` | creator_search, creator_video_analysis | Large numeric string. |
| creator handle | `unique_id` | creator_search | **Not `handle`** -- `data/seed/creator_history.json` calls this field `handle`, but the live API calls the same concept `unique_id`. `engine/seed.py` already prefers a `handle` key when present (matches the seed file); a future `normalize.py` for live API responses must read `unique_id` instead. |
| creator display name | `nickname` | creator_search | e.g. "Roxielys" for @roxm___. |
| follower count | `follower_count` | creator_search | |
| current-activity GMV | `commerce_summary.day28_gmv` | creator_search | The tool description itself says this (not lifetime `total_gmv`) is "the key current-activity metric for tiering." |
| posting cadence | `commerce_summary.day28_video_count` | creator_search | For @roxm___: **116-120** videos in the last 28 days (confirmed two ways) -- far above the `videos_per_week: 4` default in `config/settings.yaml`. That default is about what she *films toward a product*, not her total posting volume (lots of non-shop content), but worth knowing. |
| audience fit | `audience_summary.age_distribution`, `.gender_distribution` | creator_search | For @roxm___: skews 61.9% male / 31.3% female, 35-44 the largest age band -- worth a sanity check against who the spec assumes her audience is (not an engine input today, just noted). |

## Video concepts (section 6.8 Spanish gap, section 8 content insights)

| Concept | Real field(s) | Tool(s) seen on | Notes |
|---|---|---|---|
| caption/text for language detection | `caption_text` | video_search, creator_video_analysis, video_detail_analysis | Confirmed -- feed straight into `engine.language.spanish_share`. |
| video duration | `duration_seconds` | video_search, creator_video_analysis | **Not `duration_s`** (this repo's own naming in `engine/models.py`/seed file). Simple rename when mapping. |
| engagement | `like_count`, `comment_count`, `share_count`, `favorite_count`, `play_count`, `interaction_rate_percent` | video_search (nested under `engagement_metrics`), creator_video_analysis (**flat**, not nested) | Same concepts, different nesting shape between the two tools -- normalize.py needs two branches. |
| video-attributed commerce | `video_attributed_gmv`/`video_attributed_units_sold` (nested under `commerce_metrics`) | video_search | creator_video_analysis has the same concept but flat and named `video_gmv`/`video_units_sold`. |
| is this video an ad | `is_ad` | video_search (nested `traffic_flags.is_ad`), creator_video_analysis (flat `is_ad`) | Same nesting inconsistency as above. |
| published timestamp | `published_at_ts` (unix) + `published_at_display` (string, UTC+8 -- see Timezone section) | video_search | creator_video_analysis only has `published_at` (unix), no display string. |
| linked product(s) | `linked_products[]` (array -- a video can sell more than one product), `linked_product_count` | video_search, creator_video_analysis | `engine.models.CreatorVideo.product_id` (singular) will need a decision in Phase 1 about which linked product "counts" when there's more than one. |

## product_overview (confirmed 2026-10-15, Phase 1 -- 3 credits, matches spec's tier)

Called for `data/seed`'s #1 shapewear product (`1732352660592628585`), `time_range_days=28`. Real shape, not guessed:

| Concept | Real field(s) | Notes |
|---|---|---|
| ads-vs-organic risk input (section 6.9, `ads_share_pct`) | `ads_distribution.breakdown[]`, each row `{traffic_source, gmv_share_percent, units_sold_share_percent, ...}` | **Not** a flat `ads_share_percent` field (that was a guess, now corrected in `engine/normalize.py`). Find the row where `traffic_source == "ad_traffic"` and read its `gmv_share_percent`. Only two traffic_source values seen: `"ad_traffic"` and `"non_ad_video_traffic"`. |
| momentum `lead` term (section 6.2) | `daily_trend[].daily_new_linked_creator_count`, `.daily_new_linked_video_count` | **This is the lead signal, directly** -- no need for `product_creator_analysis`/`product_video_list` as originally guessed in the spec text. Sum the last 7 days' values vs the prior 7 for `engine.features.lead_raw`. Needs `time_range_days >= 14`. |
| buyer demographics (age/gender) for the audience-fit extension | **not present anywhere in the response** | Confirmed absent (`ads_distribution`, `channel_distribution`, `content_distribution`, `daily_trend`, `period_summary` -- none carry buyer age/gender). The audience-fit term always falls back to `engine.fit.demographic_fit_heuristic` (keyword-based); there is no FastMoss tool call yet found that returns this. |
| other fields seen | `channel_distribution` (product_card/shop_account/affiliate GMV split), `content_distribution` (video/live/product_card split), `period_summary.current_price`, `.linked_creator_count/live_count/video_count` (same concept as product_sales_trend's `period_summary`, just a different time window) | Not currently wired into any engine function; noted for future use. |

## `product_video_list` (confirmed 2026-10-14, 1 credit)

Called for a real 2026-W42 pick (`1732491682604749463`, Onyx Silent Vibration
device), `time_range_days=90`, `pagesize=6`. Replaces `video_search`'s
keyword search for both the Spanish-gap signal and the dashboard's video
section -- `video_search` matched by loose text keywords and returned videos
unrelated to the product (homecoming, movie trailers); filtering by
`product_id` here returns only videos FastMoss has actually linked to it,
confirmed by reading the real captions ("Silent wrist band alarm", "Onyx
Vibration Alarm", etc. -- all genuinely about this product).

Real shape, not guessed -- note this is a flat `videos[]` array, **not**
nested under `.items` the way `video_search`'s response is:

| Concept | Real field(s) | Notes |
|---|---|---|
| video id | `video_id` | |
| caption/text for language detection | `video_meta.caption_text` | Same use as `video_search`'s field of the same name -- feeds `engine.language.spanish_share` unchanged. |
| thumbnail | `video_meta.cover_url` | For the dashboard's video thumbnails. |
| TikTok link (for embedding) | `video_meta.tiktok_url` | e.g. `https://www.tiktok.com/@showmeproducts/video/7687390788933651743` -- feed straight into TikTok's oEmbed/`blockquote.tiktok-embed`. |
| views | `engagement_metrics.play_count` | |
| likes/comments/shares | `engagement_metrics.like_count`, `.comment_count`, `.share_count` | |
| sales attributed to this video | `product_contribution.window_gmv`, `.window_units_sold` | Window is `product_contribution.metric_window_days` (matches the `time_range_days` filter). |
| creator | `creator.creator_handle`, `.creator_uid` | |
| is this an ad | `traffic_flags.is_ad` | Flat, like `creator_video_analysis`; `video_search` nests it as `traffic_flags.is_ad` too (same shape here, good). |
| published timestamp | `video_meta.published_at` (unix) | No display string like `video_search`'s `published_at_display`. |
| FastMoss's own page for the video | `video_meta.fastmoss_url` | |

**`orderby` correction (2026-10-15, free, no paid call needed):** this
tool's `docs/fastmoss_tools.json` capture originally had `"orderby": {
"type": "array" }` with no `items`/enum at all, which read as an
undocumented/untrustworthy sort. It wasn't a gap in the API -- it was a gap
in our capture. The live tool schema (fetched via ToolSearch, which loads a
tool's own definition, not a paid call) documents it fully:
`items.properties.field.enum = ["gmv", "units_sold", "digg_count",
"play_count", "share_count"]`. `units_sold` is real and now used in
`engine/ingest.py`'s `fetch_product_videos`. We still re-sort client-side
regardless (`engine/normalize.py`'s `rank_videos_by_sales`) for the
GMV/play_count tiebreak the API's single-field sort can't replicate --
belt and suspenders, not blind trust either way.

## `fastmoss_detail_url_examples` (confirmed 2026-10-15, free)

Takes no arguments. Confirmed template for a product's own FastMoss page
(used for the dashboard's "Ver en FastMoss" button):
`https://www.fastmoss.com/e-commerce/detail/{product_id}`. Also returns
templates for creator/shop/live/video detail pages (not currently used).
No TikTok Shop URL template is returned by anything FastMoss exposes --
there is no confirmed way to build a direct TikTok Shop product link from a
FastMoss product_id, so the dashboard does not have an "Abrir en TikTok
Shop" button.

## `live_search` (tested 2026-10-16, 3 real calls, 3 credits -- Part C7b verification)

Confirmed real response shape: `{list: [{creator: {...}, live: {room_id, title, started_at, ended_at, duration_seconds, linked_product_count, cover_url}, performance_summary: {live_gmv, live_units_sold, gmv_per_viewer, total_viewer_count, currency}}], total}`. `started_at`/`ended_at` are Unix seconds (not confirmed yet whether UTC or UTC+8 -- performance_summary's `currency: "USD"` and matching US-looking handles suggest these are already in a sensible timezone for a US-region filter, but this needs a second check against a live with a known real-world time before trusting it for a "best hour" conversion).

**Two real problems found, not yet worked around:**
- `filter.product_category` (an integer category ID, confirmed via the tool's own schema) returned an **empty list** for both `601259` (shapewear's `fastmoss_category_id`) and `871048` (furniture's) against the same 28-day US window that returned 60,000 total lives with no category filter. Our `config/categories.yaml` category IDs may be from a different taxonomy than whatever `live_search` expects for `product_category` -- unconfirmed which ID space it wants.
- `orderby: [{field: "total_gmv"|"total_units_sold", order: "desc"}]` returned the **exact same 10 lives in the exact same order** for both fields -- real evidence the ordering isn't sorting by either field for this account/window. Every one of those 10 lives also had `live_gmv: 0, live_units_sold: 0, gmv_per_viewer: 0` despite real `total_viewer_count` (11-3513) and `linked_product_count` (0-48), so GMV/units attribution may simply lag behind most lives ending, separate from the ordering bug.

Fixture: `tests/fixtures/live_search_us_28d.json`. Part C7b (live-posting-time, "best hour to go live per category, ranked by GMV/units") can't be built against this endpoint as designed until one of these is resolved -- either the right category-ID space for `product_category`, or a working `orderby`, or both. Flagged to Ryan instead of spending the other 9 categories' credits repeating the same broken pattern.

## Not yet confirmed

- Review **count** (vs. the `product_rating` average found via `video_detail_analysis`) -- candidate: `product_review_list`.
- Explicit `category_l2` string separate from the l1/l2/l3 object shape for `engine.models.Product.category_l2` -- probably just `category.l2.name`, same shape as l1, not separately confirmed with its own call.
- `rank_delta` over time -- needs two weekly snapshots to compute; nothing to confirm from a single run.
