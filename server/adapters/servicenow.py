"""ServiceNow HAM Pro adapter — the only file that knows ServiceNow exists.

Two things about the integration drive the whole design:

1. ``sn_hamp_m2m_audit_asset`` is a *pre-populated roster, not a scan log*. It
   has a ``scanned`` boolean defaulting to false, one row per expected asset.
   Every write here updates an existing row; nothing appends.

2. This adapter holds no credentials. Auth is OAuth Authorization Code + PKCE,
   client-direct to the instance, so the caller's own bearer token arrives with
   the request and is passed through. Writes therefore run as the auditor and
   are subject to the auditor's ACLs, which is the correct blast radius — and
   it means a compromise of this server leaks no standing access.
"""

import httpx

from domain import Position, RosterEntry, Sheet, ShelfResult

# HAM Pro column names vary by version, and the display label is not the column
# name. Confirm these against sys_dictionary filtered to the table before any
# run against production; they are gathered here so that check is one diff.
M2M_TABLE = "sn_hamp_m2m_audit_asset"
M2M_ASSET = "asset"
M2M_AUDIT = "asset_audit"
M2M_SCANNED = "scanned"

# Custom tables. ServiceNow's audit table has no concept of shelf, order or
# grouping, so neither algorithm works without these. The client never touches
# them; only this adapter does.
POSITION_TABLE = "u_audit_position"
SHEET_TABLE = "u_audit_sheet"

# One scripted endpoint on the instance takes a whole batch: it resolves tags
# against alm_hardware, updates the m2m rows, and enforces validation in one
# place. It is also code UniMelb's own ServiceNow team reads and change-manages
# inside their own instance, which is the strongest verifiability argument
# available — it asks nobody to trust this repository.
SCAN_ENDPOINT = "/api/x_assetwalk/scan"
SHELVES_ENDPOINT = "/api/x_assetwalk/shelves"

TIMEOUT = httpx.Timeout(30.0)


def instance_url(raw: str) -> httpx.URL:
    """PKCE assumes TLS. It defends against an attacker who captures the
    redirect but is not on the network path; over plaintext it provides
    nothing at all. So a non-HTTPS instance is rejected outright rather than
    warned about."""
    url = httpx.URL(raw)
    if url.scheme != "https":
        raise ValueError(f"instance URL must be https, got {url.scheme!r}")
    return url


class ServiceNowStore:
    def __init__(self, instance: str, bearer: str) -> None:
        self.client = httpx.Client(
            base_url=instance_url(instance),
            headers={"Authorization": bearer, "Accept": "application/json"},
            timeout=TIMEOUT,
        )

    def roster(self, walk_id: str) -> list[RosterEntry]:
        rows = self._table(
            M2M_TABLE,
            sysparm_query=f"{M2M_AUDIT}={walk_id}",
            sysparm_fields=f"{M2M_ASSET},{M2M_SCANNED}",
        )
        # The roster is every row on the audit, scanned or not. A row already
        # flipped true is still expected to be there — this is a walk, not a
        # resumption of a partially-written log.
        return [
            RosterEntry(asset=_display(row[M2M_ASSET]), location=None)
            for row in rows
            if row.get(M2M_ASSET)
        ]

    def history(self, location_id: str) -> list[Position]:
        rows = self._table(
            POSITION_TABLE,
            sysparm_query=f"u_location={location_id}^ORDERBYu_sequence",
            sysparm_fields="u_location,u_sequence,u_asset_tag",
        )
        return [
            Position(
                location=_display(row["u_location"]),
                sequence=int(row["u_sequence"]),
                asset=_display(row["u_asset_tag"]),
            )
            for row in rows
        ]

    def commit(self, result: ShelfResult, idempotency_key: str) -> None:
        # Confirmed and relocated are the same write: the asset was found, and
        # "found" is the whole fact the roster row records.
        #
        # Unresolved assets are deliberately absent. A removal writes *nothing*
        # — the row stays scanned = false, which is already ServiceNow's
        # representation of "expected but not found". Writing a removal would
        # be inventing a second, contradictory representation of it.
        response = self.client.post(
            SCAN_ENDPOINT,
            json={
                "audit": result.walk,
                "location": result.location,
                "scanned": result.confirmed,
                # Recorded so the scoped app knows what this shelf could not
                # account for. Not a removal, and it flips no roster row.
                "unresolved": result.unresolved,
                # Not on the roster, so there is no row to flip. Reported for a
                # human to triage, never auto-created: an asset that appears
                # from nowhere is an incident, not a data-entry correction.
                "unexpected": result.new_devices,
                "positions": list(enumerate(result.confirmed)),
                "unreadable": result.unreadable,
            },
            headers={"Idempotency-Key": idempotency_key},
        )
        response.raise_for_status()

    def shelves(self, walk_id: str) -> list[ShelfResult]:
        # Read back from the scoped app rather than reassembled from position
        # rows. Which shelf failed to account for a tag is a fact about a walk,
        # and positions only record where things ended up — reconstructing one
        # from the other attributes every unresolved tag to every shelf.
        response = self.client.get(SHELVES_ENDPOINT, params={"audit": walk_id})
        response.raise_for_status()
        return [ShelfResult(**shelf) for shelf in response.json().get("result", [])]

    def resolve(self, walk_id: str, found: list[str], removed: list[str]) -> None:
        # `found` flips roster rows exactly as a confirmation does: the asset
        # was located, and "located" is the whole fact.
        #
        # `removed` is sent so the scoped app can drop the position — the shelf
        # history has to stop claiming the device is there — but it never
        # touches the roster row. That row stays scanned = false, which is
        # already ServiceNow's representation of "expected but not found".
        self.client.post(
            SCAN_ENDPOINT,
            json={
                "audit": walk_id,
                "scanned": found,
                "removed": removed,
                "reconciliation": True,
            },
            headers={"Idempotency-Key": f"{walk_id}:reconciliation"},
        ).raise_for_status()

    def record_sheets(self, sheets: list[Sheet]) -> None:
        for sheet in sheets:
            self.client.post(
                f"/api/now/table/{SHEET_TABLE}",
                json={
                    "u_sheet_id": sheet.id,
                    "u_location": sheet.location,
                    "u_member_tags": ",".join(sheet.members),
                    "u_count": len(sheet.members),
                    "u_printed_at": sheet.printed_at,
                },
            ).raise_for_status()

    def sheets(self, location_id: str) -> list[Sheet]:
        rows = self._table(
            SHEET_TABLE,
            sysparm_query=f"u_location={location_id}",
            sysparm_fields="u_sheet_id,u_location,u_member_tags,u_printed_at",
        )
        return [
            Sheet(
                id=row["u_sheet_id"],
                walk=location_id,
                location=_display(row["u_location"]),
                printed_at=row["u_printed_at"],
                members=[tag for tag in row["u_member_tags"].split(",") if tag],
            )
            for row in rows
        ]

    def _table(self, table: str, **query: str) -> list[dict]:
        response = self.client.get(f"/api/now/table/{table}", params=query)
        response.raise_for_status()
        return response.json().get("result", [])


def _display(value: object) -> str:
    """Reference fields come back as ``{"value": sys_id, "display_value": tag}``
    or as a bare string depending on ``sysparm_display_value``. Both shapes are
    real; guessing wrong yields sys_ids where asset tags belong."""
    if isinstance(value, dict):
        return str(value.get("display_value") or value.get("value") or "")
    return str(value)
