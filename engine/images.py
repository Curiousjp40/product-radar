"""Caches remote product/video thumbnails into web/public/img/ at run time
(added 2026-10-16, spec dashboard redesign) so the dashboard never depends on
hotlinking FastMoss's/TikTok's CDN -- a cross-origin `<img src>` straight to
`s.500fd.com` can be blocked by the CDN's own referrer/hotlink rules, and even
when it works it's one more runtime dependency a static site shouldn't need.

`_guess_extension` is pure and unit-tested; `cache_image` is the thin network
I/O wrapper around it (not unit-tested directly, consistent with the rest of
this codebase -- see engine/ingest.py's fetch_* functions).
"""

from __future__ import annotations

import re
import urllib.request
from pathlib import Path

IMG_DIR = Path(__file__).resolve().parent.parent / "web" / "public" / "img"
_EXT_RE = re.compile(r"\.(jpe?g|png|webp|gif)(?::\d+:\d+)?$", re.IGNORECASE)


def _guess_extension(url: str) -> str:
    """FastMoss's CDN URLs end in e.g. `...resize-jpeg:800:800.jpeg` or
    `...crop-webp:1280:1280.webp` -- the real extension, ignoring the
    `:WxH` crop-size suffix some of them have. Defaults to `.jpg` when no
    known extension is found."""
    match = _EXT_RE.search(url)
    if not match:
        return ".jpg"
    ext = match.group(1).lower()
    return ".jpg" if ext == "jpeg" else f".{ext}"


def cache_image(url: str | None, stem: str) -> str | None:
    """Downloads `url` into web/public/img/<stem><ext>. Returns the site-root
    path ("/img/<stem><ext>") to use in exported JSON on success, or None if
    `url` is falsy or the download fails -- callers fall back to the
    original remote url in that case, never a broken local path."""
    if not url:
        return None
    dest = IMG_DIR / f"{stem}{_guess_extension(url)}"
    if dest.exists():
        return f"/img/{dest.name}"
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request, timeout=10) as response:
            dest.write_bytes(response.read())
        return f"/img/{dest.name}"
    except Exception:
        return None
