"""CSV import and export, for standalone deployments.

An organisation with no ITAM platform still has a spreadsheet. This is the way
in and the way out, and it is the reason standalone mode is a real deployment
rather than a demo.
"""

import csv
from typing import TextIO

from adapters.sqlstore import SqlStore
from domain import Position
from reconcile import reconcile


def import_walk(store: SqlStore, walk_id: str, rows: TextIO) -> int:
    """Read ``location,sequence,asset`` and seed the shelf histories.

    The roster follows from them: every asset with a position in a location
    this audit covers is an asset the audit expects to find.
    """
    history = [
        Position(
            location=row["location"], sequence=int(row["sequence"]), asset=row["asset"]
        )
        for row in csv.DictReader(rows)
    ]
    store.seed(walk_id, history)
    return len(history)


def export_reconciliation(store: SqlStore, walk_id: str, out: TextIO) -> None:
    """One row per asset that needs a human. Removal candidates and relocations
    are both here, distinguished by ``outcome`` — a relocation is not a
    variance, and a spreadsheet that conflates them causes the exact
    false-removal problem the algorithm exists to avoid."""
    result = reconcile(store.shelves(walk_id))
    writer = csv.writer(out)
    writer.writerow(["asset", "outcome", "expected_at", "found_at"])
    for move in result.relocated:
        writer.writerow([move.asset, "relocated", move.expected_at, move.found_at])
    for candidate in result.candidates:
        writer.writerow([candidate.asset, "not_found", candidate.location, ""])
    for asset in result.new_devices:
        writer.writerow([asset, "unexpected", "", ""])
