"""Weekly Spanish email digest (Phase 4), sent Monday mornings alongside the
GitHub Actions run. Rendering is a pure function (`render_digest`) so it's
unit-testable without touching the network; `send_digest` is the thin I/O
wrapper around Gmail SMTP.

CLI entry (called from .github/workflows/weekly-run.yml, after engine.run
has written web/public/data/picks.json for the week):
    python -m engine.digest
Reads GMAIL_USER, GMAIL_APP_PASSWORD, DIGEST_TO, DASHBOARD_URL from the
environment -- see the Phase 4 setup walkthrough for where those come from.
"""

from __future__ import annotations

import json
import os
import smtplib
from email.message import EmailMessage
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent


def _pick_row_html(pick: dict[str, Any]) -> str:
    return f"""
    <tr style="border-bottom:1px solid #e5e5e5">
      <td style="padding:12px 8px;vertical-align:top">
        <div style="font-weight:600">{pick["slot"]}. {pick["clean_title"]}</div>
        <div style="color:#666;font-size:13px">
          ${pick["price"]:.2f} &middot; {pick["commission_rate"] * 100:.0f}% comisión &middot;
          pagas ~${pick["earnings_per_sale"]:.2f}/venta
        </div>
        <div style="margin:6px 0 0;font-size:13px;color:#333">{pick["summary_es"]}</div>
      </td>
    </tr>"""


def render_digest(picks: list[dict[str, Any]], week: str, dashboard_url: str) -> tuple[str, str, str]:
    """Returns (subject, plain_text_body, html_body). Pure function -- no
    network, no SMTP -- so it's covered by unit tests on its own."""
    subject = f"Product Radar: tus {len(picks)} productos para filmar esta semana ({week})"

    plain_lines = [f"Tus {len(picks)} productos para filmar esta semana ({week}):", ""]
    for p in picks:
        plain_lines.append(f"{p['slot']}. {p['clean_title']} -- ${p['price']:.2f}, pagas ~${p['earnings_per_sale']:.2f}/venta")
        plain_lines.append(f"   {p['summary_es']}")
        plain_lines.append("")
    plain_lines.append(f"Ver el tablero completo: {dashboard_url}")
    plain_text = "\n".join(plain_lines)

    rows = "".join(_pick_row_html(p) for p in picks)
    html = f"""
    <html><body style="font-family:Arial,Helvetica,sans-serif;color:#222">
      <h2 style="margin-bottom:4px">Tus productos para filmar esta semana</h2>
      <p style="color:#666;margin-top:0">Semana {week} &middot; {len(picks)} productos</p>
      <table style="width:100%;border-collapse:collapse">{rows}</table>
      <p style="margin-top:20px">
        <a href="{dashboard_url}" style="background:#111;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px">
          Ver el tablero completo
        </a>
      </p>
    </body></html>"""
    return subject, plain_text, html


def build_email(
    picks: list[dict[str, Any]],
    week: str,
    dashboard_url: str,
    from_addr: str,
    to_addr: str,
) -> EmailMessage:
    subject, plain_text, html = render_digest(picks, week, dashboard_url)
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg.set_content(plain_text)
    msg.add_alternative(html, subtype="html")
    return msg


def send_digest(
    picks: list[dict[str, Any]],
    week: str,
    dashboard_url: str,
    smtp_user: str,
    smtp_password: str,
    to_addr: str,
    host: str = "smtp.gmail.com",
    port: int = 587,
) -> None:
    """Sends via Gmail SMTP with STARTTLS. `smtp_password` must be a Gmail
    App Password (smtp_user's real account password won't work once 2FA is
    on, and "less secure app access" no longer exists) -- see the Phase 4
    setup walkthrough for how to generate one."""
    msg = build_email(picks, week, dashboard_url, from_addr=smtp_user, to_addr=to_addr)
    with smtplib.SMTP(host, port) as server:
        server.starttls()
        server.login(smtp_user, smtp_password)
        server.send_message(msg)


def main() -> None:
    picks_path = REPO_ROOT / "web" / "public" / "data" / "picks.json"
    data = json.loads(picks_path.read_text(encoding="utf-8"))
    picks, week = data["picks"], data["week"]

    smtp_user = os.environ["GMAIL_USER"]
    smtp_password = os.environ["GMAIL_APP_PASSWORD"]
    to_addr = os.environ["DIGEST_TO"]
    dashboard_url = os.environ["DASHBOARD_URL"]

    if not picks:
        print(f"No picks for {week} -- skipping the digest email.")
        return
    send_digest(picks, week, dashboard_url, smtp_user, smtp_password, to_addr)
    print(f"Sent {len(picks)}-pick digest for {week} to {to_addr}.")


if __name__ == "__main__":
    main()
