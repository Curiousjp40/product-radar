"""Re-downloads product photos and video thumbnails that the exported data
points at (web/public/img/...) but that are missing on disk.

Uses 0 FastMoss credits: the original CDN URLs come from the week's saved
snapshots (top_selling_*.json for products, videos_*.json for video covers).

Why this exists: before 2026-10-15 the weekly workflow committed the data JSON
but not web/public/img, so images downloaded in CI were thrown away.

Run: python -m engine.backfill_images
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from engine.images import IMG_DIR, cache_image

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "web" / "public" / "data"
SNAPSHOT_DIR = ROOT / "data" / "snapshots"
_LOCAL_RE = re.compile(r"^/img/(product|video)_(\d+)\.[a-z]+$")


def _remote_urls() -> tuple[dict[str, str], dict[str, str]]:
    """product_id -> cover_url and video_id -> cover_url from every saved
    snapshot (newest weeks win)."""
    products: dict[str, str] = {}
    videos: dict[str, str] = {}
    for week_dir in sorted(p for p in SNAPSHOT_DIR.iterdir() if p.is_dir()):
        for f in week_dir.glob("top_selling_*.json"):
            for item in json.loads(f.read_text()).get("list") or []:
                if item.get("product_id") and item.get("cover_url"):
                    products[str(item["product_id"])] = item["cover_url"]
        for f in week_dir.glob("videos_*.json"):
            for v in json.loads(f.read_text()).get("videos") or []:
                cover = (v.get("video_meta") or {}).get("cover_url")
                if v.get("video_id") and cover:
                    videos[str(v["video_id"])] = cover
    return products, videos


def _local_paths(node: object, out: set[str]) -> None:
    if isinstance(node, dict):
        for value in node.values():
            _local_paths(value, out)
    elif isinstance(node, list):
        for value in node:
            _local_paths(value, out)
    elif isinstance(node, str) and _LOCAL_RE.match(node):
        out.add(node)


def main() -> None:
    wanted: set[str] = set()
    for f in DATA_DIR.rglob("*.json"):
        if "sample" in f.parts:
            continue
        _local_paths(json.loads(f.read_text()), wanted)
    missing = sorted(p for p in wanted if not (IMG_DIR / p.removeprefix("/img/")).exists())
    products, videos = _remote_urls()
    fetched = failed = 0
    for path in missing:
        kind, ident = _LOCAL_RE.match(path).groups()  # type: ignore[union-attr]
        url = (products if kind == "product" else videos).get(ident)
        if url and cache_image(url, f"{kind}_{ident}") == path:
            fetched += 1
        else:
            failed += 1
    print(f"images referenced: {len(wanted)}, missing: {len(missing)}, fetched: {fetched}, still missing: {failed}")


if __name__ == "__main__":
    main()
