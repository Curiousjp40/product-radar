"""Spanish-share detection for the Spanish-gap signal, spec section 6.8.

No external language-detection dependency (spec section 0.7: prefer simple,
explainable math) -- a Spanish stopword ratio plus an accented-character boost
is enough to tell "this caption is in Spanish" apart from English captions,
which is all `spanish_share` needs.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

_SPANISH_STOPWORDS = {
    "de", "la", "que", "el", "en", "y", "a", "los", "del", "se", "las", "por",
    "un", "para", "con", "no", "una", "su", "al", "lo", "como", "mas", "pero",
    "sus", "le", "ya", "o", "este", "si", "porque", "esta", "entre", "cuando",
    "muy", "sin", "sobre", "tambien", "me", "hasta", "hay", "donde", "quien",
    "desde", "todo", "nos", "durante", "uno", "les", "ni", "contra", "otros",
    "ese", "eso", "ante", "ellos", "esto", "mi", "antes", "algunos",
    "unos", "yo", "otro", "otras", "otra", "tanto", "esa", "estos",
    "mucho", "quienes", "nada", "muchos", "cual", "poco", "ella", "estar",
    "estas", "algunas", "algo", "nosotros", "te", "es", "soy",
    "son", "fue", "ser", "mejor", "gracias", "aqui", "amor",
}
_ACCENTED_CHARS = set("áéíóúñÁÉÍÓÚÑ¿¡")
_WORD_RE = re.compile(r"[a-záéíóúñü]+", re.IGNORECASE)


def is_spanish_text(text: str, stopword_ratio_threshold: float = 0.12) -> bool:
    """True if `text` looks like Spanish."""
    if not text or not text.strip():
        return False
    tokens = _WORD_RE.findall(text.lower())
    if not tokens:
        return False
    has_accents = any(ch in _ACCENTED_CHARS for ch in text)
    stopword_ratio = sum(1 for t in tokens if t in _SPANISH_STOPWORDS) / len(tokens)
    score = stopword_ratio + (0.3 if has_accents else 0.0)
    return score >= stopword_ratio_threshold


def spanish_share(captions: Sequence[str]) -> float | None:
    """Share of `captions` classified as Spanish, or None if the list is empty
    (caller should treat that as "not computed", e.g. default audience_fit to
    0.5 per spec section 6.6)."""
    if not captions:
        return None
    return sum(1 for c in captions if is_spanish_text(c)) / len(captions)
