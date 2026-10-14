"""Presentation-text helpers for the simplified dashboard cards (added
2026-10-16): shortening a real FastMoss title down to the first few
meaningful words, and joining reason fragments into one plain sentence.
Pure functions, no FastMoss-shape knowledge -- that stays in normalize.py.
"""

from __future__ import annotations

import re

_SEPARATOR_RE = re.compile(r"\s+-\s+|[;,|]")
_BRACKETS_RE = re.compile(r"[\[\]()]")
_FILLER_WORDS = {"official", "store"}


def clean_title(title: str, max_words: int = 6) -> str:
    """Real FastMoss titles are "core name - SEO filler, filler, filler" or
    "[Brand Official] core name filler filler" -- take the first
    separator-delimited segment, drop bracket punctuation and a small
    filler-word stoplist, then keep the first `max_words` tokens. Titles with
    no natural separator (no dash/comma/semicolon/pipe) just get hard-cut at
    `max_words`, which can land mid-phrase -- the spec calls for "~6 words,"
    not a guaranteed-clean cut."""
    first_segment = _SEPARATOR_RE.split(title, maxsplit=1)[0]
    first_segment = _BRACKETS_RE.sub(" ", first_segment)
    tokens = [tok for tok in first_segment.split() if tok.lower() not in _FILLER_WORDS]
    return " ".join(tokens[:max_words]).strip()


def join_reasons_as_sentence(reason_texts: list[str], lang: str) -> str:
    """Combines up to 2 reason fragments (each already a standalone
    sentence, e.g. "Ventas subiendo 27% esta semana") into ONE sentence for
    the simplified card, instead of a bullet list."""
    texts = [t for t in reason_texts if t][:2]
    if not texts:
        return ""
    if len(texts) == 1:
        sentence = texts[0]
    else:
        connector = " y " if lang == "es" else " and "
        second = texts[1][0].lower() + texts[1][1:] if texts[1] else texts[1]
        sentence = f"{texts[0]}{connector}{second}"
    return sentence if sentence.endswith(".") else f"{sentence}."
