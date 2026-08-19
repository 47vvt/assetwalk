"""Cross-shelf reconciliation.

Removal is decided here, once, across the whole audit — never during a walk
and never per shelf. A tag unresolved on shelf A is very often confirmed on
shelf C, and deciding per shelf turns every internal move into a false removal
*and* a false new asset at the same time.

This runs on the server because it is the only place with the global view.
That is also what keeps it off the device: no phone ever needs the full
picture in order for the audit to reach the right answer.
"""

from domain import Candidate, Reconciliation, Relocation, ShelfResult


def reconcile(shelves: list[ShelfResult]) -> Reconciliation:
    # A shelf walked twice supersedes itself. Auditors do go back and re-check
    # after "Missed it", and the later look is the true one.
    latest = {shelf.location: shelf for shelf in shelves}
    walked = list(latest.values())

    found_at: dict[str, str] = {}
    for shelf in walked:
        for asset in shelf.confirmed:
            found_at[asset] = shelf.location

    relocated: list[Relocation] = []
    candidates: list[Candidate] = []
    for shelf in walked:
        for asset in shelf.unresolved:
            where = found_at.get(asset)
            if where is None:
                # Unresolved everywhere. This is the only population where
                # "removed" is even a candidate answer, and a human still
                # decides — unexplained inventory variance is an incident, not
                # a data-entry correction.
                candidates.append(Candidate(asset=asset, location=shelf.location))
            elif where != shelf.location:
                relocated.append(
                    Relocation(asset=asset, expected_at=shelf.location, found_at=where)
                )

    # Deduplicated across shelves: a device that moved between two shelves
    # mid-audit is reported by both, and it is still one device.
    new_devices = sorted({asset for shelf in walked for asset in shelf.new_devices})

    return Reconciliation(
        relocated=relocated,
        candidates=candidates,
        new_devices=new_devices,
    )
