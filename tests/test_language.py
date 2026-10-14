import pytest

from engine.language import is_spanish_text, spanish_share


def test_detects_clear_spanish_caption():
    assert is_spanish_text("Este producto es increible y lo necesitas ya, mira que bueno esta")


def test_detects_english_caption_as_not_spanish():
    assert not is_spanish_text("This product is amazing and you need it right now trust me")


def test_accented_characters_boost_detection():
    # short caption, few stopwords, but unmistakably Spanish via accents/punctuation
    assert is_spanish_text("¡Increíble! Lo más rápido que vendí")


def test_empty_text_is_not_spanish():
    assert not is_spanish_text("")
    assert not is_spanish_text("   ")


def test_spanish_share_empty_list_returns_none():
    assert spanish_share([]) is None


def test_spanish_share_mixed_captions():
    captions = [
        "Este producto es increible y lo necesitas ya",
        "This is amazing you need it now",
        "Que bueno esta esto, se los recomiendo a todos",
    ]
    assert spanish_share(captions) == pytest.approx(2 / 3)
