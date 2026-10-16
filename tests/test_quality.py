
from engine.quality import (
    filter_off_category,
    has_low_creator_density,
    is_boilerplate_title,
    is_price_outlier,
    is_round_price,
    low_affiliate_channel_share,
    off_category_drop_reason,
    shop_round_price_cluster_ids,
    suspicious_reasons,
)

# The real cluster that motivated this module: three unrelated products from
# shop "peaouter", all priced at exactly $200, two with boilerplate titles.
PEAOUTER_HOOKS = {
    "product_id": "1732508081350873951",
    "title": "Multi-Purpose Handy Hooks - Home Supplies Organizer, Storage Shelf Compatible, "
    "Meticulous Wrapping, Fast Shipping; Contact Customer Service for Inquiries, Handy Hook",
    "shop_id": "peaouter_shop_id",
    "price": 200.0,
    "gmv_7d": 126993.65,
}
PEAOUTER_CLOCK = {
    "product_id": "1732507817475085151",
    "title": "Care.fully packaged, promptly shipped, please contact customer service with any questions",
    "shop_id": "peaouter_shop_id",
    "price": 200.0,
    "gmv_7d": 115199.35,
}
PEAOUTER_STICKERS = {
    "product_id": "1732507958384825183",
    "title": "Vinyl Window Stickers & Films - Home Decor Items, Decal Sticker for Room Decoration, "
    "Meticulous Wrap, Quick Delivery, Customer Service Support for Inquiries",
    "shop_id": "peaouter_shop_id",
    "price": 200.0,
    "gmv_7d": 115197.22,
}
LEGIT_MIRROR = {
    "product_id": "legit-1",
    "title": "Sweetcrispy Aluminium LED Backlit Arched Floor Standing Mirror",
    "shop_id": "sweetcrispy_shop_id",
    "price": 90.0,
    "gmv_7d": 5000.0,
}


def test_is_boilerplate_title_catches_known_phrases():
    assert is_boilerplate_title(PEAOUTER_HOOKS["title"])
    assert is_boilerplate_title(PEAOUTER_CLOCK["title"])
    assert is_boilerplate_title(PEAOUTER_STICKERS["title"])
    assert not is_boilerplate_title(LEGIT_MIRROR["title"])


def test_is_price_outlier():
    assert is_price_outlier(price=500, category_median_price=100, multiplier=4.0)
    assert not is_price_outlier(price=200, category_median_price=73, multiplier=4.0)  # real case: 200 < 4*73
    assert not is_price_outlier(price=10, category_median_price=0, multiplier=4.0)  # no div by zero


def test_is_round_price():
    assert is_round_price(200.0)
    assert is_round_price(50.0)
    assert not is_round_price(49.99)
    assert not is_round_price(45.0, divisor=50)  # not a multiple of 50
    assert not is_round_price(0)


def test_shop_round_price_cluster_flags_unrelated_same_shop_same_price():
    candidates = [PEAOUTER_HOOKS, PEAOUTER_CLOCK, PEAOUTER_STICKERS, LEGIT_MIRROR]
    flagged = shop_round_price_cluster_ids(candidates)
    assert flagged == {PEAOUTER_HOOKS["product_id"], PEAOUTER_CLOCK["product_id"], PEAOUTER_STICKERS["product_id"]}
    assert LEGIT_MIRROR["product_id"] not in flagged


def test_shop_round_price_cluster_does_not_flag_real_variants():
    # same shop, same round price, but near-duplicate titles (color variants) -- legitimate
    variant_a = {"product_id": "v1", "title": "Cozy Wool Blanket - Grey", "shop_id": "s1", "price": 50.0}
    variant_b = {"product_id": "v2", "title": "Cozy Wool Blanket - Beige", "shop_id": "s1", "price": 50.0}
    flagged = shop_round_price_cluster_ids([variant_a, variant_b])
    assert flagged == set()


def test_shop_round_price_cluster_needs_min_cluster_size():
    assert shop_round_price_cluster_ids([PEAOUTER_HOOKS]) == set()


def test_has_low_creator_density():
    assert has_low_creator_density(gmv_7d=50_000, creator_count=2, gmv_threshold=20_000, min_creators=5)
    assert not has_low_creator_density(gmv_7d=50_000, creator_count=50, gmv_threshold=20_000, min_creators=5)
    assert not has_low_creator_density(gmv_7d=1_000, creator_count=2, gmv_threshold=20_000, min_creators=5)
    assert has_low_creator_density(gmv_7d=50_000, creator_count=None) is None


def test_low_affiliate_channel_share():
    breakdown = [
        {"sales_channel": "product_card", "gmv_share_percent": 85},
        {"sales_channel": "affiliate", "gmv_share_percent": 15},
    ]
    assert low_affiliate_channel_share(breakdown, threshold_pct=20)
    assert not low_affiliate_channel_share(breakdown, threshold_pct=10)
    assert low_affiliate_channel_share(None) is None
    assert low_affiliate_channel_share([{"sales_channel": "product_card", "gmv_share_percent": 100}]) is None


def test_suspicious_reasons_catches_the_real_cluster():
    candidates = [PEAOUTER_HOOKS, PEAOUTER_CLOCK, PEAOUTER_STICKERS, LEGIT_MIRROR]
    cluster = shop_round_price_cluster_ids(candidates)
    reasons = suspicious_reasons(PEAOUTER_HOOKS, category_median_price=73, shop_price_cluster_ids=cluster)
    assert len(reasons) >= 1
    assert any("round price" in r for r in reasons) or any("boilerplate" in r for r in reasons)


def test_suspicious_reasons_empty_for_clean_candidate():
    cluster: set[str] = set()
    reasons = suspicious_reasons(LEGIT_MIRROR, category_median_price=73, shop_price_cluster_ids=cluster)
    assert reasons == []


def test_suspicious_reasons_price_outlier_message():
    candidate = {"product_id": "x", "title": "Normal Product", "shop_id": "s", "price": 1000.0, "gmv_7d": 100}
    reasons = suspicious_reasons(candidate, category_median_price=50, shop_price_cluster_ids=set())
    assert any("4x" in r for r in reasons)


def test_suspicious_reasons_low_creator_density_message():
    candidate = {
        "product_id": "x",
        "title": "Normal Product",
        "shop_id": "s",
        "price": 20.0,
        "gmv_7d": 50_000,
        "creator_count": 1,
    }
    reasons = suspicious_reasons(candidate, category_median_price=50, shop_price_cluster_ids=set())
    assert any("content-driven" in r for r in reasons)


_HOME_DECOR_CFG = {
    "exclude_title_keywords": ["sticker", "stickers", "decal", "tape"],
    "require_title_keywords": ["decor", "lamp", "rug", "mirror", "vase", "pillow", "candle"],
}
_HOME_STORAGE_CFG = {"exclude_title_keywords": ["sticker", "stickers", "decal", "tape"]}


def test_off_category_drop_reason_drops_excluded_keyword():
    reason = off_category_drop_reason("Floor Wall Stickers Decorative Decals Set", _HOME_DECOR_CFG)
    assert reason is not None
    assert "sticker" in reason


def test_off_category_drop_reason_drops_when_no_required_keyword_matches():
    reason = off_category_drop_reason("Onyx Silent Vibration Wrist-Worn Device", _HOME_DECOR_CFG)
    assert reason is not None
    assert "required" in reason


def test_off_category_drop_reason_keeps_real_decor():
    assert off_category_drop_reason("Boho Ceramic Vase with Dried Flowers", _HOME_DECOR_CFG) is None


def test_off_category_drop_reason_home_storage_has_no_required_keywords():
    # home_storage only blocks excluded keywords -- no require_title_keywords,
    # so a legitimate storage item with no "decor" word still passes.
    assert off_category_drop_reason("Clear Stackable Closet Storage Bin", _HOME_STORAGE_CFG) is None


def test_off_category_drop_reason_home_storage_still_blocks_stickers():
    reason = off_category_drop_reason("Drawer Organizer Labels Stickers", _HOME_STORAGE_CFG)
    assert reason is not None


def test_filter_off_category_splits_and_tags_drop_reason():
    candidates = [
        {"product_id": "1", "config_category": "home_decor", "title": "Boho Ceramic Vase"},
        {"product_id": "2", "config_category": "home_decor", "title": "Wall Stickers Pack"},
        {"product_id": "3", "config_category": "home_storage", "title": "Closet Storage Bin"},
        {"product_id": "4", "config_category": "shapewear", "title": "High Waist Shaper"},
    ]
    categories_cfg = {"home_decor": _HOME_DECOR_CFG, "home_storage": _HOME_STORAGE_CFG, "shapewear": {}}
    kept, dropped = filter_off_category(candidates, categories_cfg)
    assert {c["product_id"] for c in kept} == {"1", "3", "4"}
    assert {c["product_id"] for c in dropped} == {"2"}
    assert "drop_reason" in dropped[0]
