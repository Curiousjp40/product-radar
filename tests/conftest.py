"""CI visibility for test failures (added 2026-10-15): a CI run that failed
on commit 2842116, then passed on an identical re-run, turned out to be
undiagnosable afterwards -- the public checks/annotations API only ever
exposed "Process completed with exit code 1", and downloading the raw job
log needs repo-admin auth this session didn't have. This makes every
pytest failure show up two ways that DON'T need that auth:

1. A `::error::` workflow command per failure, which GitHub turns into an
   annotation on the run page and *is* returned by the public
   `GET /repos/{owner}/{repo}/check-runs/{id}/annotations` endpoint.
2. A Markdown table (test name + the assertion's own message) appended to
   $GITHUB_STEP_SUMMARY, shown directly on the run's summary page.

Inert outside CI (checked via the GITHUB_ACTIONS env var GitHub Actions
itself sets on every job) -- a local `pytest` run is unaffected.
"""

from __future__ import annotations

import os

_FAILURES: list[tuple[str, str]] = []


def _in_ci() -> bool:
    return os.environ.get("GITHUB_ACTIONS") == "true"


def _escape_annotation(text: str) -> str:
    # GitHub workflow command escaping: https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def _assertion_summary(text: str) -> str:
    """The actual assertion line (pytest's "E   AssertionError: ..." or
    "E   assert ...") rather than the trailing "file:line: ExceptionType"
    line, which names the exception but drops the message."""
    error_lines = [line.strip()[2:].strip() for line in text.strip().splitlines() if line.strip().startswith("E ")]
    if error_lines:
        return error_lines[0]
    for line in reversed(text.strip().splitlines()):
        if line.strip():
            return line.strip()
    return "test failed"


def pytest_runtest_logreport(report) -> None:
    if not _in_ci() or report.when != "call" or report.outcome != "failed":
        return
    filepath, lineno, _ = report.location
    message = str(report.longrepr)
    _FAILURES.append((report.nodeid, _assertion_summary(message)))
    # Truncated well under GitHub's ~4KB per-annotation limit.
    print(f"::error file={filepath},line={lineno + 1},title=FAILED {report.nodeid}::{_escape_annotation(message[-1800:])}")


def pytest_sessionfinish(session, exitstatus) -> None:  # noqa: ARG001
    if not _in_ci() or not _FAILURES:
        return
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    with open(summary_path, "a", encoding="utf-8") as f:
        f.write(f"\n## {len(_FAILURES)} failed test(s)\n\n")
        f.write("| Test | Assertion |\n| --- | --- |\n")
        for nodeid, assertion in _FAILURES:
            escaped = assertion.replace("|", "\\|")[:300]
            f.write(f"| `{nodeid}` | {escaped} |\n")
