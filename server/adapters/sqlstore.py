"""SQLite store: development, tests, and standalone deployments.

Not a mock. Plenty of organisations have this exact physical audit problem and
no ITAM platform at all, so SQLite plus CSV import/export is a real deployment
mode — and it is the fastest way for anyone to try the project without a
ServiceNow instance to point at.

The schema models the AssetWalk domain, not ServiceNow's.
"""

import json
import sqlite3

from domain import Position, RosterEntry, Sheet, ShelfResult

SCHEMA = """
CREATE TABLE IF NOT EXISTS walk (
    id TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS location (
    id TEXT PRIMARY KEY,
    orientation TEXT NOT NULL CHECK (orientation IN ('vertical', 'horizontal'))
);
CREATE TABLE IF NOT EXISTS position (
    location TEXT NOT NULL REFERENCES location(id),
    sequence INTEGER NOT NULL,
    asset TEXT NOT NULL,
    PRIMARY KEY (location, sequence)
);
CREATE TABLE IF NOT EXISTS roster_entry (
    walk TEXT NOT NULL REFERENCES walk(id),
    asset TEXT NOT NULL,
    location TEXT,
    PRIMARY KEY (walk, asset)
);
-- One row per shelf per walk: re-walking a shelf replaces its result rather
-- than appending, so reconciliation always sees the auditor's latest look.
CREATE TABLE IF NOT EXISTS shelf_result (
    walk TEXT NOT NULL,
    location TEXT NOT NULL,
    confirmed TEXT NOT NULL,
    unresolved TEXT NOT NULL,
    new_devices TEXT NOT NULL,
    PRIMARY KEY (walk, location)
);
CREATE TABLE IF NOT EXISTS applied_key (
    key TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS sheet (
    id TEXT PRIMARY KEY,
    walk TEXT NOT NULL,
    location TEXT NOT NULL,
    printed_at TEXT NOT NULL,
    members TEXT NOT NULL
);
"""


class SqlStore:
    def __init__(self, path: str) -> None:
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.executescript(SCHEMA)
        self.db.commit()

    def roster(self, walk_id: str) -> list[RosterEntry]:
        rows = self.db.execute(
            "SELECT asset, location FROM roster_entry WHERE walk = ? ORDER BY asset",
            (walk_id,),
        )
        return [RosterEntry(asset=asset, location=location) for asset, location in rows]

    def history(self, location_id: str) -> list[Position]:
        rows = self.db.execute(
            "SELECT location, sequence, asset FROM position WHERE location = ? ORDER BY sequence",
            (location_id,),
        )
        return [
            Position(location=location, sequence=sequence, asset=asset)
            for location, sequence, asset in rows
        ]

    def commit(self, result: ShelfResult, idempotency_key: str) -> None:
        with self.db:
            # The key is claimed first and inside the same transaction as the
            # write. A retry of a request that already landed finds the key
            # taken and stops, which is what makes the retry safe rather than
            # merely likely to be safe.
            claimed = self.db.execute(
                "INSERT OR IGNORE INTO applied_key (key) VALUES (?)", (idempotency_key,)
            )
            if claimed.rowcount == 0:
                return

            self.db.execute(
                "INSERT OR REPLACE INTO shelf_result "
                "(walk, location, confirmed, unresolved, new_devices) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    result.walk,
                    result.location,
                    json.dumps(result.confirmed),
                    json.dumps(result.unresolved),
                    json.dumps(result.new_devices),
                ),
            )
            # The confirmations are the next walk's history: they are the order
            # the auditor actually met the devices in.
            self.db.execute("DELETE FROM position WHERE location = ?", (result.location,))
            self.db.executemany(
                "INSERT INTO position (location, sequence, asset) VALUES (?, ?, ?)",
                [(result.location, i, asset) for i, asset in enumerate(result.confirmed)],
            )

    def shelves(self, walk_id: str) -> list[ShelfResult]:
        rows = self.db.execute(
            "SELECT walk, location, confirmed, unresolved, new_devices "
            "FROM shelf_result WHERE walk = ? ORDER BY location",
            (walk_id,),
        )
        return [
            ShelfResult(
                walk=walk,
                location=location,
                confirmed=json.loads(confirmed),
                unresolved=json.loads(unresolved),
                new_devices=json.loads(new_devices),
            )
            for walk, location, confirmed, unresolved, new_devices in rows
        ]

    def record_sheets(self, sheets: list[Sheet]) -> None:
        with self.db:
            for sheet in sheets:
                self.db.execute(
                    "INSERT OR REPLACE INTO sheet (id, walk, location, printed_at, members) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (
                        sheet.id,
                        sheet.walk,
                        sheet.location,
                        sheet.printed_at,
                        json.dumps(sheet.members),
                    ),
                )

    def sheets(self, location_id: str) -> list[Sheet]:
        rows = self.db.execute(
            "SELECT id, walk, location, printed_at, members FROM sheet "
            "WHERE location = ? ORDER BY id",
            (location_id,),
        )
        return [
            Sheet(
                id=id_,
                walk=walk,
                location=location,
                printed_at=printed_at,
                members=json.loads(members),
            )
            for id_, walk, location, printed_at, members in rows
        ]

    # Used by the CSV importer and the tests to set up a walk. Not part of the
    # Store protocol: ServiceNow owns its own roster and never needs this.
    def seed(
        self,
        walk_id: str,
        roster: list[RosterEntry],
        history: list[Position],
        orientation: str = "vertical",
    ) -> None:
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO walk (id) VALUES (?)", (walk_id,))
            for entry in roster:
                self.db.execute(
                    "INSERT OR REPLACE INTO roster_entry (walk, asset, location) VALUES (?, ?, ?)",
                    (walk_id, entry.asset, entry.location),
                )
            for position in history:
                self.db.execute(
                    "INSERT OR IGNORE INTO location (id, orientation) VALUES (?, ?)",
                    (position.location, orientation),
                )
                self.db.execute(
                    "INSERT OR REPLACE INTO position (location, sequence, asset) VALUES (?, ?, ?)",
                    (position.location, position.sequence, position.asset),
                )
