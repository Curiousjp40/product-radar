import json
import urllib.error

import pytest

from engine.db import connect
from engine.earnings import EarningsFetchError, fetch_mis_productos, upsert_earnings


@pytest.fixture
def conn(tmp_path):
    return connect(tmp_path / "radar.db")


def test_upsert_earnings_writes_a_row(conn):
    items = [
        {
            "id": "mp_1",
            "product_id": "p1",
            "name": "Leonisa Capri",
            "category": "shapewear",
            "status": "vendiendo",
            "date_requested": "2026-10-01",
            "date_received": "2026-10-05",
            "units": 12,
            "earnings": 101.4,
            "video_links": ["https://tiktok.com/v1"],
        }
    ]
    n = upsert_earnings(conn, items)
    assert n == 1
    row = conn.execute(
        "SELECT product_id, name, status, units, earnings, video_links FROM mis_productos_earnings WHERE item_id = ?",
        ("mp_1",),
    ).fetchone()
    assert row == ("p1", "Leonisa Capri", "vendiendo", 12, 101.4, json.dumps(["https://tiktok.com/v1"]))


def test_upsert_earnings_updates_on_conflict(conn):
    base = {
        "id": "mp_1",
        "product_id": "p1",
        "name": "A",
        "category": None,
        "status": "solicitado",
        "date_requested": "2026-10-01",
        "date_received": None,
        "units": None,
        "earnings": None,
        "video_links": [],
    }
    upsert_earnings(conn, [base])
    updated = {**base, "status": "vendiendo", "units": 5, "earnings": 42.0}
    upsert_earnings(conn, [updated])
    rows = conn.execute("SELECT status, units, earnings FROM mis_productos_earnings").fetchall()
    assert rows == [("vendiendo", 5, 42.0)]


def test_upsert_earnings_skips_items_without_an_id(conn):
    n = upsert_earnings(conn, [{"product_id": "p1", "name": "no id"}])
    assert n == 0
    assert conn.execute("SELECT COUNT(*) FROM mis_productos_earnings").fetchone()[0] == 0


def test_fetch_mis_productos_sends_bearer_token_and_parses_data(monkeypatch):
    captured = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return json.dumps({"data": [{"id": "mp_1"}]}).encode("utf-8")

    def fake_urlopen(req, timeout=None):
        captured["headers"] = dict(req.header_items())
        return FakeResponse()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    items = fetch_mis_productos("secret-token")
    assert items == [{"id": "mp_1"}]
    assert captured["headers"]["Authorization"] == "Bearer secret-token"


def test_fetch_mis_productos_raises_earnings_fetch_error_on_network_failure(monkeypatch):
    def fake_urlopen(req, timeout=None):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    with pytest.raises(EarningsFetchError):
        fetch_mis_productos("secret-token")


def test_fetch_mis_productos_raises_on_unexpected_shape(monkeypatch):
    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return json.dumps({"error": "unauthorized"}).encode("utf-8")

    monkeypatch.setattr("urllib.request.urlopen", lambda req, timeout=None: FakeResponse())
    with pytest.raises(EarningsFetchError):
        fetch_mis_productos("secret-token")
