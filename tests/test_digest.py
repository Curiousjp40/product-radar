from engine.digest import build_email, render_digest

PICKS = [
    {
        "slot": 1,
        "title": "Onyx Silent Vibration Wrist-Worn Device - Alarm for Waking Up, Partner-Disturbance-Free",
        "clean_title": "Onyx Silent Vibration Wrist-Worn Device",
        "price": 42.50,
        "commission_rate": 0.25,
        "earnings_per_sale": 10.62,
        "summary_es": (
            "Las ventas de este producto subieron 27% esta semana. "
            "Pocas creadoras hablan de esto en español (0 de 6 videos)."
        ),
    },
    {
        "slot": 2,
        "title": "Play Along Cowboy Costume",
        "clean_title": "Play Along Cowboy Costume",
        "price": 149.00,
        "commission_rate": 0.10,
        "earnings_per_sale": 14.90,
        "summary_es": "Las ventas de este producto subieron 433% esta semana.",
    },
]


def test_render_digest_subject_counts_picks_and_includes_week():
    subject, _, _ = render_digest(PICKS, "2026-W42", "https://example.com")
    assert "2026-W42" in subject
    assert "2" in subject


def test_render_digest_plain_text_cites_real_numbers_and_summary():
    _, plain, _ = render_digest(PICKS, "2026-W42", "https://example.com")
    assert "Onyx Silent Vibration Wrist-Worn Device" in plain
    assert "Partner-Disturbance-Free" not in plain  # clean_title, not the full SEO title
    assert "$42.50" in plain
    assert "Las ventas de este producto subieron 27% esta semana." in plain
    assert "https://example.com" in plain


def test_render_digest_html_includes_every_pick_and_dashboard_link():
    _, _, html = render_digest(PICKS, "2026-W42", "https://example.com")
    assert "Onyx Silent Vibration Wrist-Worn Device" in html
    assert "Play Along Cowboy Costume" in html
    assert "comisión" in html
    assert 'href="https://example.com"' in html


def test_render_digest_empty_picks_still_renders():
    subject, plain, html = render_digest([], "2026-W42", "https://example.com")
    assert "0" in subject
    assert "2026-W42" in plain
    assert "<table" in html


def test_build_email_sets_headers_and_both_parts():
    msg = build_email(PICKS, "2026-W42", "https://example.com", from_addr="bot@example.com", to_addr="roxie@example.com")
    assert msg["From"] == "bot@example.com"
    assert msg["To"] == "roxie@example.com"
    assert msg.is_multipart()
    plain_part = msg.get_body(preferencelist=("plain",))
    html_part = msg.get_body(preferencelist=("html",))
    assert plain_part is not None and "Onyx" in plain_part.get_content()
    assert html_part is not None and "Onyx" in html_part.get_content()
