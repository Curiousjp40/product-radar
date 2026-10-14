"""Credit budget enforcement and logging, spec section 9.

`credit_usage_summary` (the balance check) is free, so `BudgetTracker` can
bracket expensive stages with real balance checks instead of guessing
per-call costs -- that gives exact, not estimated, credit accounting.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from engine.client import FastMossConnection

CREDIT_LOG_PATH = Path(__file__).resolve().parent.parent / "docs" / "credit_log.md"


class BudgetExceeded(RuntimeError):
    pass


@dataclass
class BudgetTracker:
    """Tracks credits spent so far this run against a hard cap. Call
    `checkpoint()` with the current balance after each stage of calls; it
    raises `BudgetExceeded` once the cap would be crossed, so callers can
    stop gracefully with whatever data they already have."""

    hard_cap: int
    starting_balance: int
    run_id: str
    stage_log: list[dict] = field(default_factory=list)
    last_balance: int = 0

    def __post_init__(self) -> None:
        self.last_balance = self.starting_balance

    @property
    def spent(self) -> int:
        return self.starting_balance - self.last_balance

    def checkpoint(self, stage: str, balance_now: int, note: str = "") -> int:
        """Records the credits spent in `stage` (since the last checkpoint)
        and raises BudgetExceeded if the run's total has crossed hard_cap."""
        stage_spent = self.last_balance - balance_now
        self.stage_log.append({"stage": stage, "credits": stage_spent, "note": note, "ts": datetime.now().isoformat()})
        self.last_balance = balance_now
        if self.spent > self.hard_cap:
            raise BudgetExceeded(f"spent {self.spent} credits, over the {self.hard_cap} hard cap (after stage {stage!r})")
        return stage_spent

    def would_exceed(self, estimated_additional_credits: int) -> bool:
        return self.spent + estimated_additional_credits > self.hard_cap


async def check_balance(client: FastMossConnection) -> int:
    result = await client.call("credit_usage_summary", {})
    return int(result["balance"]["available_credits"])


def write_ledger_row(conn: sqlite3.Connection, run_id: str, tool: str, credits: int, ok: bool, note: str = "") -> None:
    conn.execute(
        "INSERT INTO credit_ledger (ts, run_id, tool, credits, ok, note) VALUES (?, ?, ?, ?, ?, ?)",
        (datetime.now().isoformat(), run_id, tool, credits, 1 if ok else 0, note),
    )
    conn.commit()


def append_credit_log(run_id: str, date: str, credits_used: int, balance_after: int, notes: str) -> None:
    """Appends one line to docs/credit_log.md, matching its existing table
    format."""
    line = f"| {date} | {run_id} | {credits_used} | {balance_after} / 500 | {notes} |\n"
    with CREDIT_LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(line)
