"""Reconciliation is where a false removal would be created, so these tests are
mostly about what must *not* happen."""

from domain import ShelfResult
from reconcile import reconcile

WALK = "walk-2026-08"


def shelf(location: str, confirmed: list[str], unresolved: list[str], **kwargs):
    return ShelfResult(
        walk=WALK, location=location, confirmed=confirmed, unresolved=unresolved, **kwargs
    )


def test_a_tag_unresolved_here_and_confirmed_there_is_relocated_not_removed():
    result = reconcile(
        [
            shelf("BAY-A", ["UOM000001"], ["UOM000002"]),
            shelf("BAY-C", ["UOM000002", "UOM000003"], []),
        ]
    )

    assert result.candidates == []
    assert len(result.relocated) == 1
    assert result.relocated[0].asset == "UOM000002"
    assert result.relocated[0].expected_at == "BAY-A"
    assert result.relocated[0].found_at == "BAY-C"


def test_only_tags_unresolved_audit_wide_are_removal_candidates():
    result = reconcile(
        [
            shelf("BAY-A", ["UOM000001"], ["UOM000002", "UOM000004"]),
            shelf("BAY-C", ["UOM000002"], ["UOM000005"]),
        ]
    )

    assert sorted(c.asset for c in result.candidates) == ["UOM000004", "UOM000005"]
    assert [r.asset for r in result.relocated] == ["UOM000002"]


def test_a_candidate_carries_the_shelf_it_was_expected_on():
    # "Missed it" sends the auditor back to a specific place. Without the
    # location that action has nowhere to go.
    result = reconcile([shelf("BAY-B", [], ["UOM000009"])])
    assert result.candidates[0].location == "BAY-B"


def test_reconciliation_of_a_perfect_audit_asks_for_nothing():
    result = reconcile([shelf("BAY-A", ["UOM000001"], []), shelf("BAY-B", ["UOM000002"], [])])
    assert result.candidates == []
    assert result.relocated == []


def test_a_rewalked_shelf_supersedes_the_earlier_walk():
    # The auditor went back after "Missed it" and found it. The first walk's
    # unresolved list must not outlive the second look.
    result = reconcile(
        [
            shelf("BAY-A", [], ["UOM000001"]),
            shelf("BAY-A", ["UOM000001"], []),
        ]
    )
    assert result.candidates == []
    assert result.relocated == []


def test_new_devices_are_gathered_across_the_whole_audit():
    result = reconcile(
        [
            shelf("BAY-A", ["UOM000001"], [], new_devices=["UOM111111"]),
            shelf("BAY-B", ["UOM000002"], [], new_devices=["UOM222222", "UOM111111"]),
        ]
    )
    assert result.new_devices == ["UOM111111", "UOM222222"]


def test_an_internal_move_never_produces_a_removal_and_a_new_asset():
    # The failure this whole design exists to prevent: one device moving from
    # one shelf to another turning into a phantom removal on the first shelf
    # plus a phantom arrival on the second.
    result = reconcile(
        [
            shelf("BAY-A", ["UOM000001"], ["UOM000002"]),
            shelf("BAY-B", ["UOM000002"], []),
        ]
    )
    assert result.candidates == []
    assert result.new_devices == []
