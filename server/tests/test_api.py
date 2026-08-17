"""The HTTP surface, checked against the shapes the client parses.

The client validates every response at its boundary and throws loudly when a
shape changes. That is the right behaviour in the field and a bad way to find
out, so the two sides are pinned together here.
"""

import pytest
from fastapi.testclient import TestClient

import main
from adapters.sqlstore import SqlStore
from domain import Position, RosterEntry

BAY = "BAY-A3"
WALK = "walk-2026-08"
SHELF = [f"UOM{270000 + i:06d}" for i in range(4)]


@pytest.fixture
def client(tmp_path, monkeypatch):
    store = SqlStore(str(tmp_path / "api.db"))
    store.seed(
        WALK,
        [RosterEntry(asset=tag, location=BAY) for tag in SHELF],
        [Position(location=BAY, sequence=i, asset=tag) for i, tag in enumerate(SHELF)],
    )
    monkeypatch.setattr(main, "_sqlite", store)
    return TestClient(main.app)


def test_roster_is_a_bare_array_of_asset_and_location(client):
    body = client.get(f"/api/walks/{WALK}/roster").json()
    assert isinstance(body, list)
    assert set(body[0]) == {"asset", "location"}


def test_history_is_a_bare_array_in_shelf_order(client):
    body = client.get(f"/api/locations/{BAY}/history").json()
    assert [entry["asset"] for entry in body] == SHELF
    assert set(body[0]) == {"location", "sequence", "asset"}


def test_a_shelf_is_accepted_in_the_wire_shape_the_client_sends(client):
    # The reducer's own field is `newDevices`; the wire format is snake_case
    # and /client/io does the translation. If that mapping is ever dropped,
    # new assets vanish silently, so both ends are pinned here.
    response = client.post(
        f"/api/walks/{WALK}/shelves",
        headers={"Idempotency-Key": "k1"},
        json={
            "walk": WALK,
            "location": BAY,
            "confirmed": SHELF[:2],
            "unresolved": SHELF[2:],
            "new_devices": ["UOM999999"],
        },
    )
    assert response.status_code == 204

    reconciliation = client.get(f"/api/walks/{WALK}/reconciliation").json()
    assert reconciliation["new_devices"] == ["UOM999999"]


def test_a_shelf_without_an_idempotency_key_is_refused(client):
    response = client.post(
        f"/api/walks/{WALK}/shelves",
        json={"walk": WALK, "location": BAY, "confirmed": [], "unresolved": []},
    )
    assert response.status_code == 400


def test_a_shelf_belonging_to_another_walk_is_refused(client):
    response = client.post(
        f"/api/walks/{WALK}/shelves",
        headers={"Idempotency-Key": "k2"},
        json={"walk": "some-other-walk", "location": BAY, "confirmed": [], "unresolved": []},
    )
    assert response.status_code == 400


def test_a_malformed_asset_tag_is_rejected_at_the_boundary(client):
    response = client.post(
        f"/api/walks/{WALK}/shelves",
        headers={"Idempotency-Key": "k3"},
        json={"walk": WALK, "location": BAY, "confirmed": ["'; DROP TABLE"], "unresolved": []},
    )
    assert response.status_code == 422


def test_reconciliation_is_a_report_and_offers_no_way_to_record_a_removal(client):
    # Deciding a variance is not the walking auditor's job an hour after the
    # walk, so there is deliberately nothing to POST here.
    assert client.post(f"/api/walks/{WALK}/reconciliation", json=[]).status_code == 405


def test_reconciliation_reports_relocations_rather_than_removals(client):
    client.post(
        f"/api/walks/{WALK}/shelves",
        headers={"Idempotency-Key": "a"},
        json={"walk": WALK, "location": BAY, "confirmed": SHELF[:2], "unresolved": SHELF[2:]},
    )
    client.post(
        f"/api/walks/{WALK}/shelves",
        headers={"Idempotency-Key": "b"},
        json={"walk": WALK, "location": "BAY-B1", "confirmed": SHELF[2:], "unresolved": []},
    )

    body = client.get(f"/api/walks/{WALK}/reconciliation").json()
    assert body["candidates"] == []
    assert sorted(move["asset"] for move in body["relocated"]) == sorted(SHELF[2:])


def test_sheets_round_trip_through_the_registry(client):
    sheets = [
        {
            "id": f"{BAY}-2026-08-17-1",
            "walk": WALK,
            "location": BAY,
            "printed_at": "2026-08-17",
            "members": SHELF,
        }
    ]
    assert client.post(f"/api/locations/{BAY}/sheets", json=sheets).status_code == 204

    body = client.get(f"/api/locations/{BAY}/sheets").json()
    assert body[0]["members"] == SHELF
    assert body[0]["printed_at"] == "2026-08-17"


def test_a_sheet_filed_under_the_wrong_location_is_refused(client):
    sheets = [
        {
            "id": "X-1",
            "walk": WALK,
            "location": "SOMEWHERE-ELSE",
            "printed_at": "2026-08-17",
            "members": SHELF,
        }
    ]
    assert client.post(f"/api/locations/{BAY}/sheets", json=sheets).status_code == 400
