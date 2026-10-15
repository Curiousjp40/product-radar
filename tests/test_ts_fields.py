from engine.ts_fields import extract_interface_fields

SAMPLE = """
export interface Other {
  ignored: string;
}

export interface Thing {
  required_field: string;
  // a comment line should be ignored
  optional_field?: number | null;
  nested_inline: { a: number; b: number } | null;
  list_field: string[];
}

export interface AfterThing {
  also_ignored: boolean;
}
"""


def test_extracts_required_and_optional_fields():
    required, optional = extract_interface_fields(SAMPLE, "Thing")
    assert required == {"required_field", "nested_inline", "list_field"}
    assert optional == {"optional_field"}


def test_does_not_pick_up_fields_from_other_interfaces():
    required, optional = extract_interface_fields(SAMPLE, "Thing")
    assert "ignored" not in required
    assert "also_ignored" not in required


def test_missing_interface_raises():
    try:
        extract_interface_fields(SAMPLE, "DoesNotExist")
        raise AssertionError("expected ValueError")
    except ValueError:
        pass


def test_stops_at_the_interface_own_closing_brace_despite_nested_braces():
    # the inline nested object's own `}` must not be mistaken for Thing's end
    required, _ = extract_interface_fields(SAMPLE, "Thing")
    assert required == {"required_field", "nested_inline", "list_field"}
