import pytest

from engine.budget import BudgetExceeded, BudgetTracker, check_balance, write_ledger_row
from engine.client import FixtureReplayClient
from engine.db import connect


def test_budget_tracker_checkpoint_computes_stage_spend():
    tracker = BudgetTracker(hard_cap=80, starting_balance=500, run_id="test")
    spent = tracker.checkpoint("stage1", balance_now=490)
    assert spent == 10
    assert tracker.spent == 10
    assert tracker.last_balance == 490


def test_budget_tracker_raises_over_hard_cap():
    tracker = BudgetTracker(hard_cap=20, starting_balance=500, run_id="test")
    tracker.checkpoint("stage1", balance_now=490)  # 10 spent, under cap
    with pytest.raises(BudgetExceeded):
        tracker.checkpoint("stage2", balance_now=470)  # 30 spent total, over cap


def test_budget_tracker_would_exceed():
    tracker = BudgetTracker(hard_cap=20, starting_balance=500, run_id="test")
    tracker.checkpoint("stage1", balance_now=490)  # 10 spent
    assert tracker.would_exceed(5) is False
    assert tracker.would_exceed(15) is True


async def test_check_balance_reads_fixture():
    client = FixtureReplayClient({"credit_usage_summary": "fastmoss_credit_usage_summary.json"})
    async with client:
        balance = await check_balance(client)
    assert balance == 500


def test_write_ledger_row(tmp_path):
    conn = connect(tmp_path / "radar.db")
    write_ledger_row(conn, run_id="r1", tool="product_rank_top_selling", credits=1, ok=True, note="shapewear")
    row = conn.execute("SELECT run_id, tool, credits, ok, note FROM credit_ledger").fetchone()
    assert row == ("r1", "product_rank_top_selling", 1, 1, "shapewear")
