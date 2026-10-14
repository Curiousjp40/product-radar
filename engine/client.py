"""FastMoss MCP client: real connectivity (validated 2026-10-14 against the
live server -- see docs/field_map.md and docs/fastmoss_tools.json) plus a
fixture-replay stand-in for --dry-run.

The real `FastMossClient` reads `FASTMOSS_API_KEY` from the environment and
never logs it -- `_mask` strips it from any URL before it could end up in an
error message.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any, Protocol

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

FASTMOSS_MCP_URL = "https://mcp.fastmoss.com/mcp"
FIXTURES_DIR = Path(__file__).resolve().parent.parent / "tests" / "fixtures"


class FastMossError(RuntimeError):
    pass


def _mask(url: str) -> str:
    head, sep, _ = url.partition("api_key=")
    return head + sep + "***" if sep else url


def _content_text(result: Any) -> str:
    for block in result.content:
        if hasattr(block, "text"):
            return block.text
    raise FastMossError("tool result had no text content block")


def _unwrap(parsed: dict[str, Any]) -> dict[str, Any]:
    """Some FastMoss tools (e.g. search_category_by_words) wrap their payload
    as {"params": ..., "result": {...}, "tool_id": ...}; others (e.g.
    credit_usage_summary) return the payload directly at the top level --
    confirmed inconsistent across tools during Phase 1 testing. Unwrap only
    when both "result" and "tool_id" are present, to avoid false-positives on
    a response that happens to use "result" as a real field name."""
    if isinstance(parsed, dict) and "result" in parsed and "tool_id" in parsed:
        inner = parsed["result"]
        if isinstance(inner, dict):
            return inner
    return parsed


class FastMossConnection(Protocol):
    """What engine/ingest.py depends on -- satisfied by both FastMossClient
    (real) and FixtureReplayClient (dry-run), so ingest code never branches
    on which one it has."""

    async def __aenter__(self) -> FastMossConnection: ...
    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None: ...
    async def call(self, tool: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]: ...


class FastMossClient:
    """Async context manager wrapping a live FastMoss MCP session over
    Streamable HTTP.

    >>> async with FastMossClient() as client:
    ...     balance = await client.call("credit_usage_summary", {})
    """

    def __init__(self, api_key: str | None = None, max_retries: int = 3, retry_backoff_s: float = 1.5):
        self.api_key = api_key or os.environ.get("FASTMOSS_API_KEY")
        if not self.api_key:
            raise FastMossError("FASTMOSS_API_KEY is not set")
        self.max_retries = max_retries
        self.retry_backoff_s = retry_backoff_s
        self._transport_cm: Any = None
        self._session_cm: Any = None
        self.session: ClientSession | None = None

    async def __aenter__(self) -> FastMossClient:
        url = f"{FASTMOSS_MCP_URL}?api_key={self.api_key}"
        self._transport_cm = streamable_http_client(url)
        try:
            read, write = await self._transport_cm.__aenter__()
        except Exception as e:
            raise FastMossError(f"could not connect to {_mask(url)}: {e}") from e
        self._session_cm = ClientSession(read, write)
        self.session = await self._session_cm.__aenter__()
        await self.session.initialize()
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        if self._session_cm is not None:
            await self._session_cm.__aexit__(exc_type, exc, tb)
        if self._transport_cm is not None:
            await self._transport_cm.__aexit__(exc_type, exc, tb)

    async def call(self, tool: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        """Calls `tool`, retrying transient failures with linear backoff, and
        returns the parsed JSON result."""
        if self.session is None:
            raise FastMossError("use `async with FastMossClient() as client`")
        last_error: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                result = await self.session.call_tool(tool, arguments or {})
                if result.is_error:
                    raise FastMossError(f"{tool} returned an error: {_content_text(result)[:300]}")
                return _unwrap(json.loads(_content_text(result)))
            except Exception as e:  # noqa: BLE001 -- retried uniformly, re-raised after max_retries
                last_error = e
                if attempt < self.max_retries:
                    await asyncio.sleep(self.retry_backoff_s * attempt)
        raise FastMossError(f"{tool} failed after {self.max_retries} attempts: {last_error}") from last_error


class FixtureReplayClient:
    """Dry-run stand-in: replays saved fixtures instead of hitting the
    network, so `python -m engine.run --dry-run` costs zero credits.
    `tool_to_fixture` maps tool name -> fixture filename under
    tests/fixtures/; a tool with no mapped fixture raises rather than
    returning made-up data, so a dry-run can never silently fabricate a
    response."""

    def __init__(self, tool_to_fixture: dict[str, str]):
        self.tool_to_fixture = tool_to_fixture
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def __aenter__(self) -> FixtureReplayClient:
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        return None

    async def call(self, tool: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        self.calls.append((tool, arguments or {}))
        fixture_name = self.tool_to_fixture.get(tool)
        if fixture_name is None:
            raise FastMossError(f"no fixture mapped for dry-run tool {tool!r}")
        raw = json.loads((FIXTURES_DIR / fixture_name).read_text(encoding="utf-8"))
        return raw.get("result", raw)
