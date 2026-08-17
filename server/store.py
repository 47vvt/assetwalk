"""The storage seam.

This is the one abstraction in the project that exists before its second
caller was written, and only because the second implementation is specified:
SQLite for development, test and standalone deployments, ServiceNow for
production. Both are exercised by the same contract test suite, which is how
the ServiceNow adapter stays honest without a live instance.
"""

from typing import Protocol

from domain import Position, RosterEntry, Sheet, ShelfResult


class Store(Protocol):
    def roster(self, walk_id: str) -> list[RosterEntry]:
        """Every asset this walk expects to find, across all its locations."""

    def history(self, location_id: str) -> list[Position]:
        """One shelf's positional history, in shelf order.

        Scoped to a single location by design: this method is what enforces
        the data-minimisation rule, because the device asks for one shelf at a
        time and holds it in memory only.
        """

    def commit(self, result: ShelfResult, idempotency_key: str) -> None:
        """Record one walked shelf.

        Must be idempotent on ``idempotency_key``: the client retries over an
        unreliable link, and a retry after an ambiguous timeout must not apply
        the shelf twice. Re-walking a shelf under a fresh key replaces the
        earlier result rather than adding to it — the auditor went back and
        looked again, and the second look is the true one.
        """

    def shelves(self, walk_id: str) -> list[ShelfResult]:
        """Every shelf committed to this walk so far.

        Reconciliation needs the whole audit at once, which is exactly why it
        happens here and not on a device.
        """

    def record_sheets(self, sheets: list[Sheet]) -> None:
        """Register printed QR sheets: which were printed, for which substacks,
        with what counts."""

    def sheets(self, location_id: str) -> list[Sheet]:
        """The sheets last printed for a location."""
