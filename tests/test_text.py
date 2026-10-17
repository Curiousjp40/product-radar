from engine.text import clean_title, days_remaining_phrase, extract_brand, join_reasons_as_sentence

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


def test_clean_title_falls_back_when_first_segment_is_brand_only():
    # real case: "Comfrt" alone before the next separator is unreadable on
    # its own -- falls back to a longer cut of the full title instead.
    title = "Comfrt Original Scuff Pillow Slippers for Women and Men Fuzzy House Slippers, Soft Cushioned"
    cleaned = clean_title(title)
    assert cleaned.startswith("Comfrt")
    assert len(cleaned.split()) >= 3


def test_clean_title_falls_back_when_first_segment_is_a_size_spec():
    # real case: the first segment ends up being pure digits/quotes once
    # brackets are stripped -- falls back to the full title so real words
    # (brand, product type) show up instead of just dimensions.
    title = '[MRH] 10"12"14" -Inch Twin Full Queen King Mattress Topper Protector'
    cleaned = clean_title(title)
    assert "MRH" in cleaned
    assert any(w.isalpha() and len(w) > 2 for w in cleaned.split())


def test_clean_title_real_mattress_example_with_commas_throughout():
    # Real bug (design review item 0.12): this exact title (flagged in the
    # review as an example of raw seller titles leaking through) used to
    # come back completely unchanged -- commas fused into their neighbor
    # tokens ("King,Luxury") hid real words from the fallback's isalpha()
    # word count, so the whole raw title "passed" as readable.
    title = 'MRH 10"12 "14" -Inch Twin, Full, Queen, King,Luxury Hybrid Mattress -Memory Foamand'
    cleaned = clean_title(title)
    assert cleaned != title
    assert len(cleaned) < len(title)
    assert "MRH" in cleaned


def test_clean_title_never_returns_pure_junk():
    assert clean_title('10" 12" 14"') == '10" 12" 14"'  # no real words anywhere -- last resort is the title itself


def test_join_reasons_as_sentence_two_fragments_real_example():
    # the real motivating case: each fragment is already a complete sentence
    sentence = join_reasons_as_sentence(
        ["Las ventas de este producto subieron 31% esta semana.", "Buen momento antes de Black Friday (faltan 44 días)."], "es"
    )
    assert sentence == "Las ventas de este producto subieron 31% esta semana. Buen momento antes de Black Friday (faltan 44 días)."


def test_join_reasons_as_sentence_one_fragment():
    fragment = "Las ventas de este producto subieron 27% esta semana."
    assert join_reasons_as_sentence([fragment], "es") == fragment


def test_join_reasons_as_sentence_empty():
    assert join_reasons_as_sentence([], "es") == ""


def test_join_reasons_as_sentence_only_uses_first_two():
    sentence = join_reasons_as_sentence(["Uno.", "Dos.", "Tres."], "es")
    assert sentence == "Uno. Dos."


def test_days_remaining_phrase_plural_and_singular():
    assert days_remaining_phrase(44, "es") == "faltan 44 días"
    assert days_remaining_phrase(1, "es") == "falta 1 día"
    assert days_remaining_phrase(44, "en") == "44 days left"
    assert days_remaining_phrase(1, "en") == "1 day left"


def test_days_remaining_phrase_today_and_past():
    assert days_remaining_phrase(0, "es") == "es hoy"
    assert days_remaining_phrase(0, "en") == "today"
    assert days_remaining_phrase(-3, "es") == ""
    assert days_remaining_phrase(-3, "en") == ""


def test_extract_brand_real_duplicate_case_comfrt():
    assert extract_brand("Comfrt") == "comfrt"
    assert extract_brand("Comfrt Memory Foam Clog Slides") == "comfrt"


def test_extract_brand_real_duplicate_case_crocs():
    assert extract_brand("Crocs Women's Dylan Animal Platform Clogs") == "crocs"
    assert extract_brand("Crocs Women's Dylan Platform Elevated Clogs") == "crocs"


def test_extract_brand_strips_bracket_noise():
    assert extract_brand("[Dr.Melaxin Official] Peel Shot Keratin Care") == "dr.melaxin"


def test_extract_brand_different_brands_differ():
    assert extract_brand("Tipsy Elves Women's Original Halloween Costumes") != extract_brand("YIANNA V-Shaped Shapewear")
