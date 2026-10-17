"""Presentation-text helpers for the simplified dashboard cards (added
2026-10-16): shortening a real FastMoss title down to the first few
meaningful words, and joining reason fragments into one plain sentence.
Pure functions, no FastMoss-shape knowledge -- that stays in normalize.py.
"""

from __future__ import annotations

import re

_SEPARATOR_RE = re.compile(r"\s+-\s+|[;,|]")
# ASCII brackets plus the full-width/CJK brackets some real titles use for
# the same "[Brand]"-style prefix (found 2026-10-15: "「MRH」10\"12\"14\"
# -Inch Twin" wasn't stripped at all, since only ASCII [] () were handled).
_BRACKETS_RE = re.compile(r"[\[\]()【】「」『』]")
_FILLER_WORDS = {"official", "store"}
# A result this short, or made up mostly of digits/quotes/dashes (size specs
# like `10"12"14" -Inch`), reads as junk rather than a product name.
_JUNK_CHARS_RE = re.compile(r"^[\d\"'×x/.\-\s]+$", re.IGNORECASE)


_ALPHA_RUN_RE = re.compile(r"[A-Za-z]{3,}")


def _unreadable(text: str) -> bool:
    """Too short, pure junk characters, or mostly size-spec/digit tokens
    with only a word or two of real text mixed in (real case: "MRH
    10\"12\"14\" -Inch Twin" has 5 "words" but only "MRH" and "Twin" are
    actually words) -- needs at least 3 real (3+ letter, alphabetic) words
    to read as a product name. Real words are found with a regex run
    (not `word.isalpha()` on whitespace-split tokens) so punctuation stuck
    to a word -- "Twin," "King,Luxury" from an un-comma-split fallback
    title, "-Inch" from a leading dash -- doesn't hide a real word from
    the count or fuse two real words into one unreadable token (the real
    bug design review item 0.12 flagged: a mattress title with commas
    throughout fooled this into accepting the whole raw title as
    "readable" and returning it unchanged)."""
    words = text.split()
    if len(words) < 2 or _JUNK_CHARS_RE.match(text):
        return True
    real_words = _ALPHA_RUN_RE.findall(text)
    return len(real_words) < 3


def clean_title(title: str, max_words: int = 6) -> str:
    """Real FastMoss titles are "core name - SEO filler, filler, filler" or
    "[Brand Official] core name filler filler" -- take the first
    separator-delimited segment, drop bracket punctuation and a small
    filler-word stoplist, then keep the first `max_words` tokens. Titles with
    no natural separator (no dash/comma/semicolon/pipe) just get hard-cut at
    `max_words`, which can land mid-phrase -- the spec calls for "~6 words,"
    not a guaranteed-clean cut.

    Falls back to a longer cut of the FULL title (added 2026-10-15) when
    that first segment is unreadable on its own -- a brand-only title
    ("Comfrt ...", nothing else before the next separator) or one whose
    first segment is a size spec ("[MRH] 10\"12\"14\" -Inch Twin" -> just
    the size numbers) both produced junk otherwise."""
    first_segment = _SEPARATOR_RE.split(title, maxsplit=1)[0]
    first_segment = _BRACKETS_RE.sub(" ", first_segment)
    tokens = [tok for tok in first_segment.split() if tok.lower() not in _FILLER_WORDS]
    result = " ".join(tokens[:max_words]).strip()
    if not _unreadable(result):
        return result

    # Commas are a segment separator for the first-segment cut above, but
    # the full-title fallback never ran through _SEPARATOR_RE -- a stray
    # comma mid-title ("Twin, Full, Queen, King,Luxury Hybrid Mattress")
    # fused words together or hid real words when simply whitespace-split,
    # so letting the whole raw title through "readable" unchanged. Strip
    # commas/semicolons the same way brackets are stripped, not just split
    # on whitespace.
    full = _BRACKETS_RE.sub(" ", title)
    full = re.sub(r"[,;]", " ", full)
    full_tokens = [tok for tok in full.split() if tok.lower() not in _FILLER_WORDS]
    fallback = " ".join(full_tokens[: max_words * 2]).strip()
    if not _unreadable(fallback):
        return fallback
    return " ".join(full_tokens).strip() or title.strip()


def extract_brand(title: str) -> str:
    """A rough brand key for the "max 1 pick per brand" diversity rule
    (added 2026-10-19, real case: two near-identical "Comfrt" products and
    two near-identical Crocs clogs both made the same week's picks) --
    real titles consistently lead with the brand name ("Comfrt ...",
    "Crocs Women's Dylan ...", "[Dr.Melaxin Official] ...", "YIANNA ...",
    "Tipsy Elves ..."), so the first token after stripping bracket noise is
    a decent, cheap signal. Not meant to be a precise brand database --
    just consistent enough that the same real brand produces the same key."""
    stripped = _BRACKETS_RE.sub(" ", title).strip()
    first_token = stripped.split()[0] if stripped.split() else stripped
    return first_token.lower()


def join_reasons_as_sentence(reason_texts: list[str], lang: str) -> str:
    """Combines up to 2 reason fragments into one short paragraph for the
    simplified card, instead of a bullet list. Each fragment from
    engine/picks.py's _REASON_TEMPLATES is already a complete, natural
    sentence on its own (e.g. "Las ventas de este producto subieron 27% esta semana."), so
    this is a plain join, not a run-on "X y Y" -- rewritten 2026-10-17 after
    the joined version read as one awkward clause instead of two natural
    ones (see the real example: "Las ventas de este producto subieron 31% esta semana. Buen
    momento antes de Black Friday (faltan 44 días).")."""
    return " ".join(t for t in reason_texts[:2] if t)


def days_remaining_phrase(days: int, lang: str) -> str:
    """Correctly pluralized "N days left" for the seasonality reason's
    countdown (added 2026-10-17) -- e.g. "falta 1 día" vs "faltan 44 días".
    Returns "" for a negative count (the event has already passed; callers
    should skip rendering the reason entirely rather than show a negative
    countdown)."""
    if days < 0:
        return ""
    if days == 0:
        return "es hoy" if lang == "es" else "today"
    if lang == "es":
        return "falta 1 día" if days == 1 else f"faltan {days} días"
    return "1 day left" if days == 1 else f"{days} days left"
