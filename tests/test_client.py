import pytest

from engine.client import FastMossClient, FastMossError, FixtureReplayClient, _mask


def test_mask_strips_api_key_from_url():
    assert _mask("https://mcp.fastmoss.com/mcp?api_key=SECRET123") == "https://mcp.fastmoss.com/mcp?api_key=***"


def test_mask_leaves_url_without_key_alone():
    assert _mask("https://mcp.fastmoss.com/mcp") == "https://mcp.fastmoss.com/mcp"


def test_client_requires_api_key(monkeypatch):
    monkeypatch.delenv("FASTMOSS_API_KEY", raising=False)
    with pytest.raises(FastMossError):
        FastMossClient(api_key="")


@pytest.mark.asyncio
async def test_fixture_replay_returns_saved_result():
    client = FixtureReplayClient({"credit_usage_summary": "fastmoss_credit_usage_summary.json"})
    async with client:
        result = await client.call("credit_usage_summary", {})
    assert result["balance"]["available_credits"] == 500
    assert client.calls == [("credit_usage_summary", {})]


@pytest.mark.asyncio
async def test_fixture_replay_raises_for_unmapped_tool():
    client = FixtureReplayClient({})
    async with client:
        with pytest.raises(FastMossError):
            await client.call("product_rank_top_selling", {})
