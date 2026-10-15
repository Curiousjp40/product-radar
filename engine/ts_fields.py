"""Extracts field names straight from a TypeScript interface in
web/src/types.ts, so Python tests can check exported JSON against the
frontend's own types without hand-maintaining a second copy of the field
list that can silently drift out of sync with types.ts (exactly what
happened 2026-10-15: picks.json and hooks.json went live missing fields a
scratchpad script had dropped, unnoticed until browser-verifying the site)."""

from __future__ import annotations

import re
from pathlib import Path

TYPES_TS_PATH = Path(__file__).resolve().parent.parent / "web" / "src" / "types.ts"

_FIELD_LINE = re.compile(r"^(\w+)(\?)?\s*:")


def extract_interface_fields(ts_source: str, interface_name: str) -> tuple[set[str], set[str]]:
    """(required_fields, optional_fields) for `interface <name> { ... }` in
    `ts_source`. Only top-level fields -- a field whose own type is written
    as a multi-line inline object isn't supported (none of the interfaces
    this is used for need that; see test_export_completeness.py)."""
    match = re.search(rf"\binterface\s+{re.escape(interface_name)}\b[^{{]*{{", ts_source)
    if not match:
        raise ValueError(f"interface {interface_name} not found in {TYPES_TS_PATH}")
    i = match.end()
    depth = 1
    while depth > 0:
        if ts_source[i] == "{":
            depth += 1
        elif ts_source[i] == "}":
            depth -= 1
        i += 1
    body = ts_source[match.end() : i - 1]

    required: set[str] = set()
    optional: set[str] = set()
    for raw_line in body.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("//") or line.startswith("/*") or line.startswith("*"):
            continue
        field_match = _FIELD_LINE.match(line)
        if field_match:
            name, is_optional = field_match.group(1), field_match.group(2)
            (optional if is_optional else required).add(name)
    return required, optional


def load_types_ts() -> str:
    return TYPES_TS_PATH.read_text(encoding="utf-8")
