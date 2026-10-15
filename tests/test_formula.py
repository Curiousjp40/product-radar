from datetime import datetime

from engine.formula import (
    best_posting_hour,
    extract_hook,
    format_stats,
    formula_ganadora_dict,
    ideal_duration_seconds,
    top_hashtags_weighted,
    top_hooks,
    weekly_top_hashtags,
)
from engine.timeutil import EASTERN


def _video(**overrides):
    base = {
        "video_id": "1",
        "caption_text": "",
        "window_units_sold": 0,
        "window_gmv": 0.0,
        "play_count": 0,
        "is_ad": False,
        "duration_seconds": None,
        "published_at": None,
    }
    base.update(overrides)
    return base


def test_top_hashtags_weighted_by_units_sold_not_by_video_count():
    # a hashtag on a video that sold 500 must outrank one on 3 videos that
    # sold 2 each -- the real motivating case.
    videos = [
        _video(caption_text="#bigwinner love this", window_units_sold=500),
        _video(caption_text="#smallwin ok", window_units_sold=2),
        _video(caption_text="#smallwin again", window_units_sold=2),
        _video(caption_text="#smallwin more", window_units_sold=2),
    ]
    ranked = top_hashtags_weighted(videos)
    assert ranked[0] == {"hashtag": "bigwinner", "weight": 500}
    assert ranked[1] == {"hashtag": "smallwin", "weight": 6}


def test_top_hashtags_weighted_respects_limit_and_lowercases():
    videos = [_video(caption_text=f"#Tag{i}", window_units_sold=10 - i) for i in range(10)]
    ranked = top_hashtags_weighted(videos, limit=3)
    assert len(ranked) == 3
    assert ranked[0]["hashtag"] == "tag0"


def test_top_hashtags_weighted_empty():
    assert top_hashtags_weighted([]) == []


def test_weekly_top_hashtags_flattens_across_products():
    product_a = [_video(caption_text="#fajas great", window_units_sold=100)]
    product_b = [_video(caption_text="#fajas also", window_units_sold=50), _video(caption_text="#muebles nice", window_units_sold=10)]
    ranked = weekly_top_hashtags([product_a, product_b])
    assert ranked[0] == {"hashtag": "fajas", "weight": 150}
    assert ranked[1] == {"hashtag": "muebles", "weight": 10}


def test_ideal_duration_seconds_uses_median_when_available():
    videos = [_video(duration_seconds=20), _video(duration_seconds=68), _video(duration_seconds=46)]
    result = ideal_duration_seconds(videos, creator_sweet_spot_seconds=(13, 30))
    assert result == {"seconds": 46, "source": "videos"}


def test_ideal_duration_seconds_falls_back_to_creator_sweet_spot():
    videos = [_video(duration_seconds=None), _video(duration_seconds=None)]
    result = ideal_duration_seconds(videos, creator_sweet_spot_seconds=(13, 30))
    assert result == {"seconds": None, "source": "creator_default", "sweet_spot_range": [13, 30]}


def test_format_stats_real_shapes():
    videos = [
        _video(caption_text="Respuesta a @stephany gracias!", is_ad=False),
        _video(caption_text="Solo $24.99 hoy!", is_ad=True),
        _video(caption_text="normal video no price", is_ad=True),
        _video(caption_text="replying to @someone here", is_ad=False),
    ]
    stats = format_stats(videos)
    assert stats["reply_pct"] == 50.0
    assert stats["price_mention_pct"] == 25.0
    assert stats["ad_pct"] == 50.0


def test_format_stats_empty_is_all_zero_not_fabricated():
    assert format_stats([]) == {"reply_pct": 0.0, "price_mention_pct": 0.0, "ad_pct": 0.0}


def test_best_posting_hour_picks_the_mode():
    # 7pm Eastern videos should dominate over a single 9am one.
    ts_7pm = int(datetime(2026, 10, 1, 19, 0, tzinfo=EASTERN).timestamp())
    ts_7pm_2 = int(datetime(2026, 10, 2, 19, 15, tzinfo=EASTERN).timestamp())
    ts_9am = int(datetime(2026, 10, 3, 9, 0, tzinfo=EASTERN).timestamp())
    videos = [_video(published_at=ts_7pm), _video(published_at=ts_7pm_2), _video(published_at=ts_9am)]
    result = best_posting_hour(videos)
    assert result == {"hour_start": 19, "hour_end": 21}


def test_best_posting_hour_none_without_timestamps():
    assert best_posting_hour([_video(), _video()]) is None


def test_extract_hook_strips_hashtags_and_mentions_keeps_first_sentence():
    caption = "Este producto cambio mi rutina. #skincare #kbeauty @brand me encanta"
    assert extract_hook(caption) == "Este producto cambio mi rutina."


def test_extract_hook_no_sentence_punctuation_returns_whole_cleaned_caption():
    assert extract_hook("Silent wrist band alarm #histrips ") == "Silent wrist band alarm"


def test_extract_hook_empty_caption():
    assert extract_hook("") == ""
    assert extract_hook(None) == ""


def test_top_hooks_takes_first_n_in_given_order_and_skips_empty():
    videos = [
        _video(caption_text="Primero! #tag"),
        _video(caption_text="#onlyhashtags @onlymention"),  # cleans to empty, skipped
        _video(caption_text="Segundo gancho aqui."),
        _video(caption_text="Tercero, no deberia aparecer."),
    ]
    hooks = top_hooks(videos, limit=3)
    assert hooks == ["Primero!", "Segundo gancho aqui."]


def test_formula_ganadora_dict_assembles_all_pieces():
    videos = [
        _video(caption_text="#fajas Mira este cambio!", window_units_sold=50, duration_seconds=22, is_ad=True),
    ]
    result = formula_ganadora_dict(videos, creator_sweet_spot_seconds=(13, 30))
    assert result["top_hashtags"] == [{"hashtag": "fajas", "weight": 50}]
    assert result["ideal_duration"] == {"seconds": 22, "source": "videos"}
    assert result["format_stats"]["ad_pct"] == 100.0
    assert result["top_hooks"] == ["Mira este cambio!"]
