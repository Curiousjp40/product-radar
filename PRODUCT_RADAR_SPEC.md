# Product Radar: Build Spec

A weekly, automatic product-picking system for TikTok Shop affiliate creators. It watches what is selling and rising on TikTok Shop, scores every product on how much money it is likely to make **for this specific creator**, and hands her a short, ranked list every Monday with reasons, then learns from what she actually films and sells.

- **Primary user:** Roxie (@roxm___), TikTok Shop affiliate creator, Spanish-first audience, US market.
- **Second creator:** Ari (@ariannamendoza04), a friend whose results are used as a benchmark and as extra training data (with her permission).
- **Owner/builder:** Ryan, building with Claude Code.
- **Data source:** FastMoss MCP (paid Basic plan, 500 credits/month) plus the creators' own FastMoss video exports.
- **Starter data:** `data/seed/creator_history.json` (100 videos: 50 per creator, already categorized).

---

## 0. Instructions for Claude Code (read first)

1. Work phase by phase (section 12). Finish each phase's acceptance checks before starting the next.
2. **Never guess FastMoss field names or tool arguments.** Phase 0 lists the real tools and saves real responses as fixtures. Every parser is written against those fixtures. If a field this spec mentions does not exist, record it in `docs/field_map.md` and degrade gracefully (drop that feature, keep the rest working).
3. **The API key is never pasted into chat or committed.** It lives in `.env` (gitignored) locally and in a GitHub Actions secret named `FASTMOSS_API_KEY` in CI. Code reads `os.environ["FASTMOSS_API_KEY"]`. Provide `.env.example` with an empty value.
4. Every credit spent is logged (section 9). Every run checks the balance first and stops before the hard cap.
5. The UI is **Spanish-first with an English toggle**, and **mobile-first** (she uses her phone). Product reasons are generated in both languages.
6. Keep every algorithm in a pure, unit-tested function (inputs in, numbers out). The pipeline wires them together. Weights and thresholds live in YAML config, not in code.
7. Prefer simple, explainable math over black-box models. Every score shown to her must come with plain-language reasons.

---

## 1. What success looks like

- Every Monday by 7:00 AM Eastern, without anyone touching anything, she has a **Top 10 products to film this week**, each with: price, commission, dollars per sale, trend stage, expected earnings per video (typical and if it takes off), and 2 to 3 reasons.
- She can shortlist a product, track it through **sample requested, sample received, filmed, posted**, and see what it earned.
- After a few weeks the system reports how its picks actually performed (predicted vs real) and adjusts itself.
- Monthly FastMoss usage stays under 500 credits.
- North-star metric: **commission earned per video posted**, tracked monthly. Supporting metrics: share of picks filmed that beat her median GMV per video, posting consistency (videos per week), and prediction calibration.

---

## 2. What their sales history says (the starting priors)

Source: the two FastMoss video exports (top 50 videos each). Roxie's export is sorted by views and Ari's by units sold, so both are biased toward their better videos. Phase 5 fixes this by pulling complete video lists. Shop videos only.

### 2.1 Totals

| | Roxie | Ari |
|---|---|---|
| Shop videos in file | 46 | 50 |
| GMV | $21,319 | $66,007 |
| Units | 1,212 | 1,480 |
| Views | 1.96M | 2.61M |
| Median views per video | 3,683 | 10,250 |
| Median GMV per video | $44 | $371 |
| Average price per unit | $17.59 | $44.60 |
| Units per 10K views (conversion) | 6.17 | 5.68 |
| **GMV per 1K views** (conversion x price) | **$10.86** | **$25.31** |
| GMV from top 1 video / top 5 videos | 45% / 76% | 31% / 64% |

**Takeaway:** they convert viewers into buyers at about the same rate. Ari makes about 3x more because she sells **pricier products** ($44.60 vs $17.59 per unit) and gets more views per video. Price per unit is the biggest lever Roxie controls through product choice.

### 2.2 By product type

| Creator | Type | Videos | GMV | $/unit | Units per 10K views | GMV per 1K views | GMV per video |
|---|---|---|---|---|---|---|---|
| Ari | Home & decor | 21 | $48,627 | $50.13 | 13.73 | **$68.85** | $2,316 |
| Ari | Other (graduation set, summer deals) | 6 | $7,991 | $45.66 | 5.86 | $26.75 | $1,332 |
| Roxie | Shapewear | 9 | $10,754 | $37.21 | 5.59 | **$20.79** | $1,195 |
| Ari | Women's clothing | 11 | $5,508 | $27.68 | 6.01 | $16.62 | $501 |
| Roxie | Women's clothing | 11 | $5,973 | $30.17 | 3.54 | $10.67 | $543 |
| Roxie | Beauty & hair | 14 | $3,284 | $4.84 | 11.22 | $5.43 | $235 |
| Roxie | Halloween | 6 | $1,164 | $33.26 | 1.53 | $5.10 | $194 |
| Ari | Beauty & hair | 12 | $3,881 | $28.54 | 1.07 | $3.05 | $323 |
| Roxie | Home & decor | 4 | $144 | $13.09 | 2.34 | $3.06 | $36 |

**Takeaways that become rules:**
- **Home & decor** is the strongest proven category in the dataset (Ari): high price and the highest conversion. Roxie has only 4 home videos, all cheap items. Treat home & decor as a **high-priority test category for Roxie** (explore budget, section 7.4), aimed at the $30 to $70 range.
- **Shapewear** is Roxie's proven winner (BBL short: $9,499 from one video). Keep it in her core set, especially Q4.
- **Beauty under $10** converts very well for Roxie (11.2 units per 10K views) but earns little ($4.84 per unit). Deprioritize items under $10 unless the commission is unusually high.
- **Price sweet spot:** $25 to $55 per unit covers both creators' best categories.

### 2.3 Video length (shop videos)

| Creator | Length | Videos | GMV per video | Units per 10K views |
|---|---|---|---|---|
| Roxie | 12s or less | 9 | $127 | 1.9 |
| Roxie | 13 to 20s | 13 | $375 | 11.2 |
| Roxie | 21 to 30s | 17 | $836 | 4.5 |
| Roxie | 31s+ | 7 | $156 | 5.9 |
| Ari | 13 to 20s | 12 | $938 | 6.0 |
| Ari | 21 to 30s | 26 | $982 | 8.9 |
| Ari | 31s+ | 11 | $2,628 | 4.5 |

Very short videos (12s or less) underperform. 13 to 30 seconds is the reliable range. Ari's 31s+ number is driven by one $20.5K trash can video, so treat it as a single hit, not a rule.

### 2.4 Other signals

- **Views drive sales; likes do not.** Rank correlation between views and GMV is 0.61 (Roxie) and 0.59 (Ari). Interaction rate vs GMV is -0.22 (Roxie) and 0.13 (Ari). Optimize for reach and product demonstration, not engagement bait.
- **Sales are hit-driven.** Roxie's top 5 videos made 76% of her GMV. More shots at high-value products beats perfecting a few videos, so posting consistency matters.
- **Seasonality is creator-specific.** Roxie: shapewear $10,716 in Nov 2025, clothing $4,078 in Dec 2025, then near zero Feb to Jul 2026. Ari: home $23,864 in Jun 2026 and $12,589 in Jul 2026 (TikTok's summer "Deals for You Days" sale), plus a graduation set in April.
- **Posting day and hour:** the export's timezone is unknown and the samples are small. Do not build rules on it yet. Treat posting time as an experiment (section 8.4).
- **Reply-to-comment videos** ("Respuesta a @..."): mixed results (Roxie 5 videos, Ari 4). Not enough data; track it as a format tag.

---

## 3. System overview

```
           ┌────────────────────── weekly (Mon 6:15 AM ET) ──────────────────────┐
FastMoss MCP ─► ingest ─► raw snapshots ─► normalize ─► features ─► stages ─► scores + EV ─► picks ─► dashboard data + digest
                 ▲                                                        ▲                     │
creators' own videos (FastMoss) ─► outcomes ─► learning (priors, weights) ┘                     ▼
                                                     shortlist / pipeline statuses ◄── dashboard (she taps)
```

### 3.1 Recommended stack

| Part | Choice | Why |
|---|---|---|
| Engine | Python 3.12, `pandas`, `numpy`, `pydantic`, `pyyaml` | Easy, testable analytics |
| FastMoss access | Remote MCP server via the official `mcp` Python SDK (Streamable HTTP), or the FastMoss CLI. Both share the same key and credit pool. Pick one in Phase 0. | No scraping; uses the paid plan |
| Storage | SQLite (`data/radar.db`) for the engine; raw JSON snapshots per week in `data/snapshots/` | Simple, auditable, versioned |
| Schedule | GitHub Actions cron, plus manual `workflow_dispatch` | Free, reliable, no computer needs to be on |
| Dashboard | Static web app (Vite + TypeScript, no heavy framework needed) reading generated JSON | Fast on phones |
| Hosting | Public GitHub Pages site (https://curiousjp40.github.io/product-radar/), deployed by `.github/workflows/pages.yml`. Shortlist statuses saved per device in browser storage. | Free, simple; Ryan chose public (2026-10-15) |
| Digest | Weekly email in Spanish (Resend or Gmail SMTP app password, stored as a secret) | She sees picks without opening anything |

Decided 2026-10-15: public repo and public GitHub Pages site, no login. Secrets (FastMoss key, Gmail app password, Roxie's email) live only in GitHub Actions secrets and `.env`.

### 3.2 Repo layout

```
product-radar/
  PRODUCT_RADAR_SPEC.md        this file
  CLAUDE.md                    short conventions for future sessions
  .env.example                 FASTMOSS_API_KEY=
  engine/
    client.py                  FastMoss MCP/CLI wrapper: retries, credit logging, fixture replay
    budget.py                  balance check, per-run cap, ledger
    ingest.py                  pulls rankings, trends, video search, creators' videos
    normalize.py               raw -> typed rows (pydantic models built from fixtures)
    features.py                demand, momentum, saturation, earnings, price stats
    stages.py                  lifecycle classifier
    fit.py                     creator-specific fit (category priors, price fit, audience)
    seasonality.py             event calendar + personal seasonality
    language.py                Spanish-share detection for the Spanish gap signal
    scoring.py                 composite score + expected value
    picks.py                   diversity, explore/exploit, reasons
    learn.py                   outcomes, Bayesian prior updates, weight refit
    digest.py                  email builder (es/en)
    export.py                  writes web/public/data/*.json
    run.py                     CLI entry: python -m engine.run [--dry-run] [--week 2026-W43]
  config/
    creators.yaml  categories.yaml  seasons.yaml  weights.yaml  settings.yaml
  data/
    seed/creator_history.json
    snapshots/2026-W43/*.json
    radar.db
  docs/
    fastmoss_tools.json  field_map.md  credit_log.md
  tests/
    fixtures/  test_features.py  test_stages.py  test_scoring.py  test_picks.py  test_learn.py
  web/                          dashboard
  .github/workflows/weekly.yml
```

---

## 4. Data sources

### 4.1 FastMoss MCP

- Remote server: `https://mcp.fastmoss.com/mcp?api_key=...` (key from env, never logged; mask it in errors).
- About 55 tools. Cost per call: 0 credits (category ID lookup, doc search, link formats, **balance check**), 1 credit (search, rankings, listings, basic detail, single-item trends), 2 credits (product and shop trends, creator profile, content analysis, live analysis, ads), 3 credits (creator rankings, market category analysis, product overview, creator breakdown). Empty, failed or rate-limited calls are free.
- Confirmed tools (connector listing, Oct 2026; 55 total). Most relevant: `search_category_by_words` (get category_id first), `product_rank_top_selling`, `product_rank_new_listed`, `product_search`, `product_overview` (includes ads vs organic, channel and content distribution), `product_sales_trend`, `product_creator_analysis`, `product_video_list`, `product_detail_info`, `product_sku`, `product_review_list`, `market_category_ranking`, `market_category_analysis`, `creator_search`, `creator_video_analysis`, `creator_product_list`, `video_search`, `credit_usage_summary` (free balance check). Save exact input schemas in Phase 0.
- FastMoss usage rules: page/pagesize max 10 (call repeatedly for more); leaderboard `date_value` must be a completed period (daily = yesterday `YYYY-MM-DD`, weekly = last week `YYYY-ww`, monthly = last month `YYYY-MM`); empty results mean "not retrieved", not "no market"; on 402 / insufficient balance, stop and report.
- Use `product_overview` ad/organic split as a risk input: a product selling mostly through paid ads is harder for an affiliate creator to win organically (add +0.5 to R in 6.9 when ads share > 60%).
- Basic plan (active, renews monthly on the 15th): 500 credits/month, 60 requests/minute per account status, no rollover. Top-ups available.

**Fields the algorithms want** (map each to the real field in `docs/field_map.md`; mark missing ones):

| Concept | Used by |
|---|---|
| product id, title, image, category (L1/L2), shop name/id | everything |
| price (current, min, max) | earnings, price fit, risk |
| commission rate | earnings per sale |
| units and GMV: 1d, 7d, 30d, total | demand, momentum |
| growth rate | momentum |
| rank position | rank delta |
| creators/affiliates promoting, videos, lives | saturation |
| daily units series (trend tool) | slope, acceleration, stage |
| rating, reviews, delisted flag | risk |
| launch / first-listed date | emerging detection |

### 4.2 Creators' own videos

- Seed: `data/seed/creator_history.json`. Fields: `creator, handle, video_id, title, published_at, duration_s, video_type, units, gmv, views, likes, interaction_rate_pct, url, category, is_reply, hashtags`.
- Ongoing (Phase 5): pull each creator's recent videos weekly through FastMoss (creator video listing or video search by handle; 1 credit each). Also accept a manual FastMoss export upload as a fallback.

### 4.3 Settings from Roxie (fill before Phase 2)

`config/settings.yaml`, editable later from the dashboard:
- target categories and their priority; categories, brands or keywords to never show
- price range, minimum commission %
- videos she can realistically post per week
- whether she only does products with free samples
- markets: US (default)

Defaults until she answers: targets = shapewear, women's clothing, home & decor, beauty & hair, seasonal; price range $15 to $80; minimum commission 10%; capacity 4 videos/week.

---

## 5. Data model (SQLite)

```sql
products(product_id PK, title, image_url, category_l1, category_l2, shop_id, shop_name,
         first_seen_week, launch_date, delisted INTEGER DEFAULT 0)

product_snapshots(week, product_id, source,            -- source: top_selling | rising | search
         rank INTEGER, price REAL, price_min REAL, price_max REAL, commission_rate REAL,
         units_1d INTEGER, units_7d INTEGER, units_30d INTEGER, units_total INTEGER,
         gmv_7d REAL, gmv_30d REAL, growth_rate REAL,
         creator_count INTEGER, video_count INTEGER, live_count INTEGER,
         rating REAL, review_count INTEGER, raw_ref TEXT,
         PRIMARY KEY (week, product_id, source))

product_daily(product_id, day, units INTEGER, gmv REAL, PRIMARY KEY (product_id, day))

product_features(week, product_id, demand, slope14, wow, accel, rank_delta, is_new,
         earnings_per_sale, demand_per_creator, saturation, stage,
         spanish_share, risk, PRIMARY KEY (week, product_id))

scores(week, product_id, creator, fit, season, score, ev_typical, ev_upside,
         components_json, reasons_es, reasons_en, PRIMARY KEY (week, product_id, creator))

picks(week, creator, product_id, slot, kind,   -- kind: core | explore | evergreen | winner_again
         PRIMARY KEY (week, creator, product_id))

creator_videos(video_id PK, creator, published_at, duration_s, title, category,
         product_id NULL, views, units, gmv, likes, format_tags, last_updated)

pipeline(creator, product_id, status, updated_at, note,     -- shortlisted | sample_requested |
         PRIMARY KEY (creator, product_id))                  -- sample_received | filmed | posted | skipped

feedback(creator, product_id, week, signal, reason)      -- signal: not_for_me | love_it

outcomes(creator, product_id, video_id, posted_at, predicted_ev, gmv_7d, gmv_28d, views_28d)

credit_ledger(ts, run_id, tool, credits, ok INTEGER, note)
```

---

## 6. Algorithms

All scores are computed per week. "z(x)" means a robust z-score within the same category and week: `(x - median) / (1.4826 * MAD)`, clipped to [-3, 3]. With fewer than 8 products in a category, compute z across all categories instead.

### 6.1 Demand
`D = log1p(units_7d)`. Secondary: `gmv_7d`.

### 6.2 Momentum
- `slope14`: least-squares slope of `log1p(daily units)` over the last 14 days, so 0.05 means about +5% per day.
- `wow = (units_7d_now - units_7d_prev) / max(units_7d_prev, 50)`. If last week's snapshot is missing, use FastMoss growth rate.
- `accel = slope(last 7 days) - slope(previous 7 days)`
- `rank_delta = rank_prev - rank_now` (positive = climbing). `is_new` = first time in any tracked list.
- `lead = z(growth in new creators + new videos promoting the product over the last 7 days vs the prior 7)` (from `product_creator_analysis` with `time_range_days` and `product_video_list`). FastMoss's own guidance: creator/video increments lead GMV by about one week, so this is the earliest signal that a product is about to rise or has peaked.
- `M = 0.35*z(slope14) + 0.20*z(wow) + 0.15*z(accel) + 0.30*lead`

If daily series are not fetched for a product (budget), `M = z(wow)` using the 7-day numbers.

### 6.3 Lifecycle stage (rules; thresholds in `weights.yaml`)

| Stage | Rule | What she should do |
|---|---|---|
| Emerging | units_7d below category median, slope14 > +0.05, creator_count below category 40th percentile | Film now, early-mover advantage |
| Rising | slope14 > +0.02 and units_7d at or above category median | Film this week |
| Peak | -0.02 to +0.02 slope, units_7d top quartile, creators growing faster than units | Only with a strong angle |
| Evergreen | in tracked lists 6 of the last 8 weeks, abs(slope14) < 0.02 | Reliable filler for consistency |
| Declining | slope14 < -0.02 in the last 2 runs, or rank fell 20+ | Skip, or swap if already planned |

Unit-test each stage with synthetic daily series.

### 6.4 Money per sale
`E = price * commission_rate`. Use the product's open-collab rate; if the creator has a higher targeted rate recorded in `pipeline.note`, use that. Products with `E < $1.50` get a heavy penalty (section 6.9).

### 6.5 Saturation and opportunity
- `demand_per_creator = units_7d / max(creator_count, 1)`
- `saturation = growth(creator_count) - growth(units_7d)`; positive means creators are piling in faster than buyers.
- `O = z(log1p(demand_per_creator)) - 0.5*z(saturation)`

### 6.6 Creator fit (per creator)
1. **Category prior** (empirical Bayes). For each category c, compute GMV per 1K views from her own videos and shrink it toward the pooled value from both creators:
   `gpm_c = (views_c * her_gpm_c + k * pooled_gpm_c) / (views_c + k)` with `k = 200,000 views` (tunable). Normalize across categories to 0..1. Starting values come from section 2.2.
2. **Price fit:** Gaussian on log price around her GMV-weighted mean log price of selling items (Roxie starts near $30 to $37, Ari near $45 to $50), sigma 0.5. Blend toward the $25 to $55 sweet spot until she has 30+ tracked videos.
3. **Target boost / filter:** categories in settings get +0.15; excluded categories, brands or keywords are removed; "not for me" feedback lowers similar products (same L2 category or shared title keywords) by 0.1 for 8 weeks.
4. `F = 0.6*category_prior + 0.25*price_fit + 0.15*audience_fit`, where `audience_fit` = Spanish gap (6.8) normalized, or 0.5 if not computed.

### 6.7 Seasonality
- `config/seasons.yaml`: events with dates, categories and **film-by lead times**, editable each year. Start with: Halloween (costumes, film window Sep 10 to Oct 20), Black Friday/Cyber Monday (all categories; shapewear and clothing boosted; Nov 1 to Dec 2), holiday gifting (Dec 1 to 20), winter/New Year (thermal leggings, winter dresses; Dec to Jan), Valentine's (Feb), Mother's Day (US 2nd Sunday of May; Día de las Madres May 10), graduation (Apr to May), summer and TikTok's mid-year sale "Deals for You Days" (home, swimwear; dates vary, set yearly), back to school (Aug).
- Event term: +1 if the product's category matches an event whose film window overlaps the next 21 days, scaled by days remaining.
- Personal term: her historical GMV share for that category in the coming month (from her own videos, smoothed).
- `S = 0.6*event + 0.4*personal`

### 6.8 Spanish gap (the differentiator)
Only for the top ~10 candidates per week (budget). Use video search for the product (1 credit), take the top videos, and detect Spanish captions (`language.py`: accent characters, Spanish stopword ratio, or a small library such as `langdetect`). `spanish_share` = share of top videos in Spanish.
`G = z(D) * (1 - spanish_share)`: high demand plus few Spanish creators means she can be the go-to Spanish voice for that product.

### 6.9 Risk penalties
`R` sums: delisted (exclude), `E < $1.50` (+1.5), price volatility (std/mean of price over 4 weeks > 0.25, +0.5), rating < 4.0 if available (+1), creator_count in category top 5% (+0.5), unit price < $10 (+0.5, unless commission is 20% or more).

### 6.10 Composite score (0 to 100)
```
raw = 0.10*z(D) + 0.25*M + 0.20*z(log E) + 0.15*O + 0.15*z(F) + 0.10*S + 0.05*z(G) - 0.40*R
score = round(100 * sigmoid(raw))
```
Weights live in `config/weights.yaml` and are re-learned in Phase 5.

### 6.11 Expected earnings per video (dollars she earns)
```
EV_typical = V_med(c) * CVR(c) * price * commission_rate * M_mult * Sat_mult
EV_upside  = same with V_p90(c)
```
- `V_med(c)`, `V_p90(c)`: her median and 90th-percentile views for shop videos in that category (fall back to her overall: Roxie 3,683 median, Ari 10,250).
- `CVR(c)`: units per view, shrunk like 6.6 (Roxie overall 6.17 per 10K views, Ari 5.68).
- `M_mult = clamp(1 + 7*slope14, 0.5, 2.0)`; `Sat_mult = clamp(1 - 0.3*z(saturation), 0.6, 1.2)`.
- Show both numbers: "typical: ~$X, if it takes off: ~$Y". Sales are hit-driven, so the upside number matters.

### 6.12 Picks (Top 10)
1. Candidates = products scored this week for this creator after filters.
2. Blend rank: `0.5*rank(score) + 0.5*rank(EV_typical)`.
3. Diversity: max 3 per category, max 2 per shop, no near-duplicates (title token Jaccard > 0.6).
4. Slots: 7 core, 2 explore (6.13), 1 evergreen or "your winner is trending again" (a product or close match she already sold well that is Rising again).
5. Exclude anything she filmed in the last 30 days unless it is a past winner trending again.
6. Reasons: pick the 2 to 3 strongest components and render templates in Spanish and English, e.g. "Ventas subiendo 38% esta semana", "Pagas ~$6.40 por venta", "Pocas creadoras en español (2 de 10 videos)", "Temporada: Black Friday en 18 días".

### 6.13 Explore vs exploit
Each category keeps a Beta-style belief of "this category beats her median GMV per video". Each week, Thompson-sample the categories and fill the 2 explore slots from the highest sampled categories that are under-tested. This is how home & decor gets tested for Roxie without betting the whole week on it.

---

## 7. Learning loop (Phase 5)

1. Weekly, pull each creator's latest videos (FastMoss), upsert `creator_videos`, refresh numbers for videos posted in the last 28 days.
2. Link videos to products: use a product id if FastMoss returns one for the video; else fuzzy-match title/caption tokens against her pipeline items; else ask her to confirm in the dashboard (one tap).
3. Write `outcomes` with predicted EV vs actual GMV at 7 and 28 days.
4. Update category priors (6.6) and the explore beliefs (6.13) with each outcome.
5. Once 30 or more linked outcomes exist: refit weights with a ridge regression of `log1p(GMV per 1K views)` on the score components (time-decayed, half-life 12 weeks), and blend 50/50 with the prior weights. Store each weights version with its date.
6. Report on the dashboard: picks hit rate (share of filmed picks that beat her median GMV per video), predicted vs actual chart, best and worst calls, and what changed in the weights.

---

## 8. Content insights (recomputed weekly from her own videos)

1. **Length sweet spot:** GMV per video and units per 10K views by length bucket. Current advice: 13 to 30 seconds, avoid 12 seconds or less.
2. **Reach vs engagement:** keep reporting that views drive sales and likes do not.
3. **Hit tracker:** share of GMV from top videos, plus the posting cadence goal (videos per week from settings).
4. **Posting-time experiment:** once the timezone of FastMoss timestamps is confirmed in Phase 0, suggest alternating posting slots and compare median views after 8+ videos per slot.
5. **Format tags:** reply-to-comment, try-on, before/after, unboxing. Tag from caption patterns plus a manual tag in the pipeline, then compare once each tag has 5+ videos.
6. **Benchmark vs Ari:** same metrics side by side; when Ari's category beats Roxie's by a lot, suggest it as an explore category.

---

## 9. Credit budget

Estimated per weekly run:

| Step | Calls | Credits |
|---|---|---|
| Balance check | 1 | 0 |
| Top-selling ranking, 4 to 5 target categories, 2 pages each | ~8 to 10 | ~8 to 10 |
| Rising (sorted by growth) ranking, same categories | ~4 to 5 | ~4 to 5 |
| Daily trend for the top ~15 candidates | 15 | ~30 |
| Spanish-gap video search for the top ~10 | 10 | ~10 |
| Creators' recent videos (2 creators) | 2 to 4 | ~2 to 4 |
| **Total** | | **~55 to 60 / week, about 250 / month** |

Rules: check balance first; hard cap 90 credits per run; skip the optional stages (Spanish gap, then trends beyond the top 10) if the balance is under 150; never re-fetch a product's daily series if it was fetched in the last 6 days; log every call to `credit_ledger` and append a weekly line to `docs/credit_log.md`. Warn in the digest when the month's projected use passes 400.

---

## 10. Dashboard (bilingual, phone first)

1. **Esta semana / This week:** Top 10 cards (image, name, price, commission %, $ per sale, stage badge, score, EV typical and upside, reasons). Buttons: "A mi lista" (shortlist) and "No es para mí" (feedback).
2. **Radar:** all candidates in a sortable, filterable table (category, stage, price, commission, score, EV) with daily-sales sparklines.
3. **Producto:** history across weeks (rank, units, creators), trend chart, saturation chart, top videos (links out), Spanish share, similar products.
4. **Mi lista / Pipeline:** columns shortlisted, sample requested, sample received, filmed, posted, results (GMV at 7 and 28 days). Status changes save in the browser on each device.
5. **Mis resultados:** her performance by category, length and month; predicted vs actual; hit rate; Ari benchmark.
6. **Temporada:** event calendar with countdowns and film-by reminders.
7. **Ajustes:** target and excluded categories, price range, minimum commission, weekly capacity, language, advanced weights (owner only), credits used this month.

Data contract: the engine writes `web/public/data/picks.json`, `candidates.json`, `products/<id>.json`, `insights.json`, `seasons.json`, `meta.json` (run time, credits used, weights version). Version the schema with a `schema_version` field.

---

## 11. Automation, hosting, notifications

- `.github/workflows/weekly.yml`: `cron: "15 10 * * 1"` (6:15 AM Eastern during daylight time, 5:15 AM in winter), plus `workflow_dispatch`. Steps: set up Python, run tests, `python -m engine.run`, commit `data/` and `web/public/data/`, deploy.
- Secrets: `FASTMOSS_API_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `DIGEST_TO` (optional `DASHBOARD_URL`). Never echo secrets; mask the key inside any URL in logs.
- Failure handling: if FastMoss fails, retry with backoff (3 tries); if the run still fails, keep last week's dashboard and send a short "this week's update failed" email to Ryan with the error, without the key.
- Digest email (Spanish first, English below): Top 10 with one line each, 3 rising to watch, 3 to skip, season countdown, credits used.

---

## 12. Build phases and acceptance checks

**Phase 0a: Work that does not need the FastMoss key (start here if the key is not set yet)**
- Repo tooling: `pyproject.toml`, `ruff`, `pytest`, GitHub Actions CI that only runs tests.
- Seed import of `creator_history.json` into SQLite and the section 8 content insights computed from it (these use no FastMoss data).
- Section 6 algorithms written against the engine's own typed models (`engine/models.py`), not FastMoss field names, with unit tests on synthetic data. Phase 0 later maps FastMoss fields onto these models.
- Dashboard shell (section 10) running on clearly labeled synthetic sample data in `web/public/data/sample/`. Remove the sample data once real data flows.
- Accept when: `pytest` passes in CI, insights JSON is generated from the seed data, and the dashboard shell renders on a phone.

**Phase 0: Connect and discover (needs `FASTMOSS_API_KEY`)**
- Create repo, `.env.example`, `.gitignore` (includes `.env`, `*.db-journal`).
- Connect to FastMoss MCP with the key from env; list tools; save names, descriptions and input schemas to `docs/fastmoss_tools.json`.
- Make these real calls and save responses to `tests/fixtures/`: balance check; category IDs for the target categories; top-selling US products for one category (weekly); one rising/growth-sorted ranking; one product daily trend; one video search; one creator video listing for @roxm___ if a tool exists.
- Write `docs/field_map.md` (concept from 4.1 to real field, or "missing"). Confirm the timezone of timestamps.
- Accept when: fixtures exist, field map complete, credits used in Phase 0 are 15 or fewer and logged.

**Phase 1: Ingest and storage**
- `ingest.py` + `normalize.py` + DB schema; idempotent per ISO week; seed import of `creator_history.json`.
- Accept when: `python -m engine.run --dry-run` runs fully on fixtures with zero credits; a real run writes one week of snapshots within budget.

**Phase 2: Features, stages, scores, EV, picks**
- Implement section 6 as pure functions with unit tests (synthetic series for every stage; known-answer tests for z-scores, shrinkage, EV, diversity rules).
- Accept when: tests pass; `python -m engine.run --dry-run --print-picks` prints a sensible Top 10 with es/en reasons.

**Phase 3: Dashboard**
- Pages from section 10; works at 390px width; Spanish default with English toggle; loads the JSON contract.
- Accept when: all pages render with fixture data, no horizontal scroll on phone, lighthouse accessibility 90+.

**Phase 4: Automation and hosting**
- Weekly workflow, secrets, GitHub Pages deploy workflow, digest email.
- Accept when: a manual workflow run completes end to end, the dashboard updates, and the digest arrives.

**Phase 5: Learning loop**
- Section 7, plus the results page.
- Accept when: after two weekly runs, outcomes are linked and predicted vs actual shows on the dashboard.

**Phase 6: Extras**
- Spanish gap (6.8) if not already on, alerts (a shortlisted product's commission went up or price dropped, a planned product turned Declining, a past winner is Rising again), posting-time experiment, Ari benchmark page.

---

## 13. Questions for Roxie (answers go into `config/settings.yaml`)

1. Which product types does she want to target, and which should never be shown?
2. What price range does she like recommending?
3. Minimum commission % worth her time?
4. How many videos can she post per week?
5. Only products with free samples, or will she buy samples?
6. Spanish only, English only, or both in her videos?
7. Any brands she already works with or wants to work with?

---

## 14. Glossary (for the dashboard help page)

- **GMV:** total sales dollars from her videos (not what she earns).
- **Commission:** her cut of each sale; dollars per sale = price x commission %.
- **Units per 10K views:** how many people buy for every 10,000 views (conversion).
- **GMV per 1K views:** sales dollars per 1,000 views; combines conversion and price.
- **Stage:** where a product is in its trend life (Emerging, Rising, Peak, Evergreen, Declining).
- **Expected earnings:** what a video about this product typically earns her, and what it earns if it takes off.
