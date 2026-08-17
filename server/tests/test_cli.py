"""The standalone path, end to end: CSV in, walk, reconciliation CSV out."""

import cli
from adapters.sqlstore import SqlStore
from domain import ShelfResult

WALK = "walk-2026-08"
CSV = """location,sequence,asset
BAY-A3,0,UOM123456
BAY-A3,1,UOM270313
BAY-A3,2,UOM420696
BAY-B1,0,UOM551204
"""


def test_import_seeds_both_the_history_and_the_roster(tmp_path, capsys):
    source = tmp_path / "walk.csv"
    source.write_text(CSV)
    db = str(tmp_path / "standalone.db")

    assert cli.main(["--db", db, "import", WALK, str(source)]) == 0
    assert "seeded 4 positions" in capsys.readouterr().err

    store = SqlStore(db)
    assert [p.asset for p in store.history("BAY-A3")] == ["UOM123456", "UOM270313", "UOM420696"]
    # Every asset with a position is expected to be found. That is what a
    # roster is, and without one nothing resolves at step 3 of the lookup.
    assert len(store.roster(WALK)) == 4


def test_export_separates_relocations_from_variances(tmp_path, capsys):
    source = tmp_path / "walk.csv"
    source.write_text(CSV)
    db = str(tmp_path / "standalone.db")
    cli.main(["--db", db, "import", WALK, str(source)])
    capsys.readouterr()

    store = SqlStore(db)
    # UOM270313 was not found on A3; it turns up on B1. UOM420696 turns up
    # nowhere. UOM999999 was on no roster at all.
    store.commit(
        ShelfResult(
            walk=WALK,
            location="BAY-A3",
            confirmed=["UOM123456"],
            unresolved=["UOM270313", "UOM420696"],
        ),
        "k1",
    )
    store.commit(
        ShelfResult(
            walk=WALK,
            location="BAY-B1",
            confirmed=["UOM551204", "UOM270313"],
            unresolved=[],
            new_devices=["UOM999999"],
        ),
        "k2",
    )

    assert cli.main(["--db", db, "export", WALK]) == 0
    rows = [line.split(",") for line in capsys.readouterr().out.strip().splitlines()]

    assert rows[0] == ["asset", "outcome", "expected_at", "found_at"]
    outcomes = {row[0]: row[1] for row in rows[1:]}
    # A relocation is not a variance. A spreadsheet that conflates them causes
    # the exact false-removal problem the algorithm exists to avoid.
    assert outcomes == {
        "UOM270313": "relocated",
        "UOM420696": "not_found",
        "UOM999999": "unexpected",
    }
