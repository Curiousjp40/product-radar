from datetime import date

import pytest

from engine.budget import (
    BudgetExceeded,
    BudgetTracker,
    average_credits_per_run,
    check_balance,
    credits_used_for_week,
    dynamic_weekly_budget,
    mondays_remaining,
    write_ledger_row,
)
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


def test_credits_used_for_week_sums_across_resumed_run_ids(tmp_path):
    # the real case this covers: an initial ingest run_id, then a `--resume-week`
    # run_id for the SAME week that shows "0 credits" for itself -- the week's
    # real total must still include the first run_id's spend.
    conn = connect(tmp_path / "radar.db")
    write_ledger_row(conn, run_id="2026-W42-aaaaaaaa", tool="product_rank_top_selling", credits=56, ok=True)
    write_ledger_row(conn, run_id="2026-W42-bbbbbbbb", tool="spanish_gap", credits=4, ok=True)
    write_ledger_row(conn, run_id="2026-W42-cccccccc", tool="spanish_gap", credits=0, ok=True)
    write_ledger_row(conn, run_id="2026-W43-dddddddd", tool="product_rank_top_selling", credits=20, ok=True)
    assert credits_used_for_week(conn, "2026-W42") == 60
    assert credits_used_for_week(conn, "2026-W43") == 20


def test_credits_used_for_week_zero_when_no_rows(tmp_path):
    conn = connect(tmp_path / "radar.db")
    assert credits_used_for_week(conn, "2026-W50") == 0


def test_average_credits_per_run_averages_qualifying_runs(tmp_path):
    conn = connect(tmp_path / "radar.db")
    write_ledger_row(conn, run_id="2026-W41-aaaaaaaa", tool="product_rank_top_selling", credits=40, ok=True)
    write_ledger_row(conn, run_id="2026-W41-aaaaaaaa", tool="spanish_gap", credits=10, ok=True)
    write_ledger_row(conn, run_id="2026-W42-bbbbbbbb", tool="product_rank_top_selling", credits=30, ok=True)
    assert average_credits_per_run(conn) == 40


def test_average_credits_per_run_excludes_backfill_and_live_runs(tmp_path):
    conn = connect(tmp_path / "radar.db")
    write_ledger_row(conn, run_id="2026-W41-aaaaaaaa", tool="product_rank_top_selling", credits=40, ok=True)
    write_ledger_row(conn, run_id="2026-W42-bbbbbbbb", tool="product_rank_top_selling", credits=20, ok=True)
    write_ledger_row(conn, run_id="2026-W42-backfill-ffffffff", tool="product_video_list", credits=216, ok=True)
    write_ledger_row(conn, run_id="2026-W42-live-eeeeeeee", tool="live_search", credits=15, ok=True)
    assert average_credits_per_run(conn) == 30


def test_average_credits_per_run_none_with_fewer_than_two_runs(tmp_path):
    conn = connect(tmp_path / "radar.db")
    assert average_credits_per_run(conn) is None
    write_ledger_row(conn, run_id="2026-W41-aaaaaaaa", tool="product_rank_top_selling", credits=40, ok=True)
    assert average_credits_per_run(conn) is None


def test_budget_tracker_writes_ledger_row_immediately_when_conn_set(tmp_path):
    # real case, 2026-10-15: a run crashed (FastMoss rate limit) after really
    # spending ~45 credits, but before reaching the end-of-run batch write --
    # nothing was logged anywhere. checkpoint() must persist each row AS IT
    # HAPPENS so a crash right after still leaves a true record.
    conn = connect(tmp_path / "radar.db")
    tracker = BudgetTracker(hard_cap=80, starting_balance=500, run_id="r1", conn=conn)
    tracker.checkpoint("trend", balance_now=490, note="product 1/12")
    row = conn.execute("SELECT run_id, tool, credits, note FROM credit_ledger").fetchone()
    assert row == ("r1", "trend", 10, "product 1/12")


def test_budget_tracker_without_conn_does_not_touch_the_db():
    # dry-run / no-conn callers must still work exactly as before.
    tracker = BudgetTracker(hard_cap=80, starting_balance=500, run_id="r1")
    tracker.checkpoint("trend", balance_now=490)
    assert tracker.spent == 10


def test_mondays_remaining_real_case_2026_10_15_to_reset():
    # the real case this was added for: 283 credits, 4 Mondays before the
    # 2026-11-15 reset (Oct 19, 26, Nov 2, Nov 9).
    assert mondays_remaining(date(2026, 10, 15), date(2026, 11, 15)) == 4


def test_mondays_remaining_counts_today_if_it_is_a_monday():
    monday = date(2026, 10, 19)
    assert mondays_remaining(monday, date(2026, 10, 26)) == 1


def test_mondays_remaining_excludes_the_reset_date_itself():
    reset_is_a_monday = date(2026, 11, 16)  # a Monday
    assert mondays_remaining(date(2026, 11, 16), reset_is_a_monday) == 0


def test_dynamic_weekly_budget_real_case():
    # 2026-10-16: balance is now plan (283) + the 2,000-credit top-up = 2283.
    result = dynamic_weekly_budget(2283, date(2026, 10, 15), date(2026, 11, 15))
    assert result == {
        "balance": 2283,
        "safety_floor_credits": 300,
        "available_for_weekly_runs": 1983,
        "mondays_left": 4,
        "budget_per_run": 495,  # floor(1983 / 4)
    }


def test_dynamic_weekly_budget_never_goes_negative():
    result = dynamic_weekly_budget(10, date(2026, 10, 15), date(2026, 11, 15))
    assert result["budget_per_run"] == 0
    assert result["available_for_weekly_runs"] == 0


def test_dynamic_weekly_budget_divides_by_at_least_one_monday():
    # the day of the reset itself (or later): mondays_remaining is 0, but
    # the budget must still divide by something, not raise ZeroDivisionError.
    result = dynamic_weekly_budget(2283, date(2026, 11, 15), date(2026, 11, 15))
    assert result["mondays_left"] == 1
    assert result["budget_per_run"] == 1983


def test_dynamic_weekly_budget_respects_a_custom_safety_floor():
    result = dynamic_weekly_budget(2283, date(2026, 10, 15), date(2026, 11, 15), safety_floor_credits=1000)
    assert result["available_for_weekly_runs"] == 1283
    assert result["budget_per_run"] == 320  # floor(1283 / 4)
