"""Part C8: pulls Roxie's Mis Productos earnings data (what she requested,
received, filmed, posted, and actually earned -- entered by hand in
web/src/views/misProductos.ts) from the Cloudflare Worker's KV into
data/radar.db. This is the real-world outcome data Phase 3 will eventually
need to re-fit the scoring weights against; this module only collects it,
it doesn't re-fit anything yet.

Zero FastMoss credits -- this is one plain HTTP GET to our own Worker, not
a FastMoss MCP call, so it's exempt from the "ask before any paid call"
rule the same way a free credit_usage_summary check is.
"""

from __future__ import annotations

import json
import os
import sqlite3
import urllib.error
import urllib.request
from datetime import UTC, datetime
from typing import Any

WORKER_ADMIN_URL = "https://product-radar-search.roxie-radar.workers.dev/admin/mis-productos"


class EarningsFetchError(RuntimeError):
    pass


def fetch_mis_productos(token: str, url: str = WORKER_ADMIN_URL, timeout: float = 15.0) -> list[dict[str, Any]]:
    """Fetches the raw Mis Productos list from the Worker's admin route
    (bearer-token gated, see worker/src/index.js's handleAdminMisProductos).
    Raises EarningsFetchError on any failure -- a weekly run should log and
    continue, not crash, if this one optional step fails."""
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        raise EarningsFetchError(f"could not fetch Mis Productos from the Worker: {e}") from e
    data = body.get("data")
    if not isinstance(data, list):
        raise EarningsFetchError(f"unexpected response shape from {url}: {body!r}"[:300])
    return data


def upsert_earnings(conn: sqlite3.Connection, items: list[dict[str, Any]]) -> int:
    """Upserts each Mis Productos item by its own `id` (web/src/misProductos.ts's
    MisProducto.id). Returns the number of rows written."""
    synced_at = datetime.now(UTC).isoformat()
    rows = [
        (
            item.get("id"),
            item.get("product_id"),
            item.get("name"),
            item.get("category"),
            item.get("status"),
            item.get("date_requested"),
            item.get("date_received"),
            item.get("units"),
            item.get("earnings"),
            json.dumps(item.get("video_links") or []),
            synced_at,
        )
        for item in items
        if item.get("id")
    ]
    conn.executemany(
        """
        INSERT INTO mis_productos_earnings
            (item_id, product_id, name, category, status, date_requested, date_received, units, earnings, video_links, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET
            product_id=excluded.product_id, name=excluded.name, category=excluded.category,
            status=excluded.status, date_requested=excluded.date_requested, date_received=excluded.date_received,
            units=excluded.units, earnings=excluded.earnings, video_links=excluded.video_links, synced_at=excluded.synced_at
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def sync_mis_productos_earnings(conn: sqlite3.Connection, token: str) -> int:
    """Convenience wrapper: fetch + upsert in one call, for engine.run's
    weekly pipeline. Returns the number of rows synced."""
    items = fetch_mis_productos(token)
    return upsert_earnings(conn, items)


def main() -> None:
    """CLI: python -m engine.earnings
    Reads MIS_PRODUCTOS_TOKEN from the environment and does a READ-ONLY
    fetch against the Worker's /admin/mis-productos route -- zero FastMoss
    credits, no DB write. Used to confirm the secret/route work before (or
    without) running the full weekly pipeline."""
    token = os.environ.get("MIS_PRODUCTOS_TOKEN")
    if not token:
        print("MIS_PRODUCTOS_TOKEN is not set.")
        raise SystemExit(1)
    try:
        items = fetch_mis_productos(token)
    except EarningsFetchError as e:
        print(f"FAILED: {e}")
        raise SystemExit(1) from e
    print(f"OK: fetched {len(items)} Mis Productos item(s) from the Worker.")


if __name__ == "__main__":
    main()
