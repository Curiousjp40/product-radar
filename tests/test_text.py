from engine.text import clean_title, join_reasons_as_sentence

# Real 2026-W42 pick titles.


def test_clean_title_cuts_at_dash_separator():
    title = (
        "Onyx Silent Vibration Wrist-Worn Device - Alarm for Waking Up, Partner-Disturbance-Free "
        "for Heavy Sleepers, 2 Intensity Levels, Up to 3 Alarms, 14+ Day Rechargeable Battery, "
        "Cool Gadgets for Adults, Gifts for Him, Gifts for Adults"
    )
    assert clean_title(title) == "Onyx Silent Vibration Wrist-Worn Device"


def test_clean_title_drops_bracket_and_filler_word():
    title = "[Dr.Melaxin Official] Peel Shot Keratin Care Kojic Acid Turmeric Spray 200ml Pore Clearing"
    cleaned = clean_title(title)
    assert cleaned.startswith("Dr.Melaxin Peel Shot Keratin Care")
    assert "Official" not in cleaned
    assert "[" not in cleaned and "]" not in cleaned


def test_clean_title_cuts_at_comma_separator():
    title = "Caramela Beauty Cyperus Rotundus Oil - 60ml/2oz Naturally Derived Gentle Moisturizing Hair Inhibitor"
    assert clean_title(title) == "Caramela Beauty Cyperus Rotundus Oil"


def test_clean_title_short_title_unchanged():
    assert clean_title("Play Along Cowboy Costume") == "Play Along Cowboy Costume"


def test_clean_title_respects_max_words():
    assert clean_title("one two three four five six seven eight", max_words=6) == "one two three four five six"


def test_join_reasons_as_sentence_two_fragments():
    sentence = join_reasons_as_sentence(["Ventas subiendo 27% esta semana", "Pocas creadoras en espanol (2 de 10 videos)"], "es")
    assert sentence == "Ventas subiendo 27% esta semana y pocas creadoras en espanol (2 de 10 videos)."


def test_join_reasons_as_sentence_one_fragment_adds_period():
    assert join_reasons_as_sentence(["Ventas subiendo 27% esta semana"], "es") == "Ventas subiendo 27% esta semana."


def test_join_reasons_as_sentence_empty():
    assert join_reasons_as_sentence([], "es") == ""


def test_join_reasons_as_sentence_english_connector():
    sentence = join_reasons_as_sentence(["Sales up 27% this week", "Few Spanish-speaking creators (2 of 10 videos)"], "en")
    assert sentence == "Sales up 27% this week and few Spanish-speaking creators (2 of 10 videos)."
