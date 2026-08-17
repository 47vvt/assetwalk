"""One contract suite, run against every Store implementation.

This is how the ServiceNow adapter stays honest without a live instance: the
ServiceNow case runs against a transport stub that answers like the instance
does, so any divergence in what the adapter sends or expects shows up here
rather than during a walk in a comms room.
"""

import json

import httpx
import pytest

from adapters.servicenow import ServiceNowStore
from adapters.sqlstore import SqlStore
from domain import Location, Position, Sheet, ShelfResult

BAY = "BAY-A3"
WALK = "walk-2026-08"
SHELF = [f"UOM{270000 + i:06d}" for i in range(6)]


def positions(location: str, assets: list[str]) -> list[Position]:
    return [
        Position(location=location, sequence=i, asset=asset)
        for i, asset in enumerate(assets)
    ]


class Instance:
    """A stand-in ServiceNow instance.

    It implements the Table API reads the adapter makes and the scoped app's
    scripted endpoints, including the parts the scoped app owns: maintaining
    u_audit_position and recording shelf results. Writing that behaviour out
    here is the point — it is the contract the instance-side script has to
    honour, stated somewhere a reviewer can read it.
    """

    def __init__(self) -> None:
        self.roster: list[str] = []
        self.positions: list[tuple[str, int, str]] = []
        # u_audit_location is the site's catalogue of shelves; coverage is
        # which audit covers which. Two things, because a shelf outlives the
        # audits that walk it — dropping one from an audit must not dismantle
        # it, and the scoped app has to keep them apart for that to hold.
        self.locations: dict[str, str] = {}
        self.coverage: dict[str, set[str]] = {}
        self.shelf_results: dict[str, dict] = {}
        self.sheets: list[dict] = []
        self.scans: list[dict] = []
        self.keys: set[str] = set()

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        query = request.url.params.get("sysparm_query", "")

        if request.method == "GET" and path.endswith("/sn_hamp_m2m_audit_asset"):
            return self._ok([{"asset": tag, "scanned": "false"} for tag in self.roster])
        if request.method == "GET" and path.endswith("/u_audit_position"):
            wanted = query.removeprefix("u_location=").split("^")[0]
            return self._ok(
                [
                    {"u_location": location, "u_sequence": str(seq), "u_asset_tag": tag}
                    for location, seq, tag in sorted(self.positions, key=lambda p: p[1])
                    if location == wanted
                ]
            )
        if request.method == "GET" and path.endswith("/u_audit_location"):
            return self._ok(
                [
                    {"u_location": location, "u_orientation": orientation}
                    for location, orientation in sorted(self.locations.items())
                ]
            )
        if request.method == "GET" and path.endswith("/walks"):
            return self._ok(
                [
                    {
                        "id": audit,
                        "locations": [
                            {
                                "id": location,
                                "orientation": self.locations[location],
                                "walked": any(
                                    r["walk"] == audit and r["location"] == location
                                    for r in self.shelf_results.values()
                                ),
                            }
                            for location in sorted(covered)
                        ],
                    }
                    for audit, covered in sorted(self.coverage.items())
                ]
            )
        if request.method == "POST" and path.endswith("/walks"):
            self.coverage.setdefault(json.loads(request.content)["audit"], set())
            return self._ok([])
        if request.method == "POST" and path.endswith("/walks/locations"):
            body = json.loads(request.content)
            self.locations.setdefault(body["location"], body["orientation"])
            self.coverage.setdefault(body["audit"], set()).add(body["location"])
            return self._ok([])
        if request.method == "DELETE" and path.endswith("/walks/locations"):
            audit = request.url.params.get("audit", "")
            self.coverage.get(audit, set()).discard(request.url.params.get("location", ""))
            return self._ok([])
        if request.method == "GET" and path.endswith("/u_audit_sheet"):
            return self._ok(self.sheets)
        if request.method == "POST" and path.endswith("/u_audit_sheet"):
            self.sheets.append(json.loads(request.content))
            return self._ok([])
        if request.method == "GET" and path.endswith("/shelves"):
            audit = request.url.params.get("audit")
            return self._ok(
                [s for s in self.shelf_results.values() if s["walk"] == audit]
            )
        if request.method == "POST" and path.endswith("/scan"):
            return self._scan(request)
        raise AssertionError(f"unexpected request: {request.method} {path}")

    def _scan(self, request: httpx.Request) -> httpx.Response:
        key = request.headers.get("Idempotency-Key", "")
        if key in self.keys:
            return httpx.Response(200, json={"result": "already applied"})
        self.keys.add(key)

        body = json.loads(request.content)
        self.scans.append(body)

        location = body["location"]
        self.shelf_results[location] = {
            "walk": body["audit"],
            "location": location,
            "confirmed": body["scanned"],
            "unresolved": body["unresolved"],
            "newDevices": body["unexpected"],
        }
        self.positions = [p for p in self.positions if p[0] != location]
        self.positions += [(location, i, tag) for i, tag in enumerate(body["scanned"])]
        return httpx.Response(200, json={"result": "ok"})

    @staticmethod
    def _ok(result: list) -> httpx.Response:
        return httpx.Response(200, json={"result": result})


def servicenow_store() -> tuple[ServiceNowStore, Instance]:
    instance = Instance()
    store = ServiceNowStore("https://example.invalid", "Bearer test-token")
    store.client = httpx.Client(
        base_url="https://example.invalid",
        transport=httpx.MockTransport(instance.handle),
    )
    return store, instance


@pytest.fixture(params=["sqlite", "servicenow"])
def store(request, tmp_path):
    """Both implementations, seeded to the same starting state."""
    if request.param == "sqlite":
        made = SqlStore(str(tmp_path / "test.db"))
        made.seed(WALK, positions(BAY, SHELF))
        return made

    made, instance = servicenow_store()
    instance.roster = list(SHELF)
    instance.positions = [(BAY, i, tag) for i, tag in enumerate(SHELF)]
    instance.locations = {BAY: "vertical"}
    instance.coverage = {WALK: {BAY}}
    return made


def test_roster_lists_every_expected_asset(store):
    assert sorted(entry.asset for entry in store.roster(WALK)) == sorted(SHELF)


def test_history_comes_back_in_shelf_order(store):
    history = store.history(BAY)
    assert [position.asset for position in history] == SHELF
    assert [position.sequence for position in history] == list(range(len(SHELF)))


def test_history_is_scoped_to_one_location(store):
    # The scoping is the whole reason this tier exists: a device asks for one
    # shelf and must not be able to pull the site.
    assert store.history("BAY-NOWHERE") == []


def test_commit_replaces_the_shelf_history_with_what_was_walked(store):
    walked = [SHELF[1], SHELF[0], SHELF[4]]
    store.commit(
        ShelfResult(
            walk=WALK,
            location=BAY,
            confirmed=walked,
            unresolved=[SHELF[2], SHELF[3], SHELF[5]],
        ),
        "key-1",
    )
    assert [position.asset for position in store.history(BAY)] == walked


def test_commit_is_idempotent_on_its_key(store):
    result = ShelfResult(walk=WALK, location=BAY, confirmed=[SHELF[0]], unresolved=[])
    store.commit(result, "key-repeat")
    store.commit(result, "key-repeat")
    assert [position.asset for position in store.history(BAY)] == [SHELF[0]]


def test_a_second_walk_of_a_shelf_supersedes_the_first(store):
    store.commit(
        ShelfResult(walk=WALK, location=BAY, confirmed=[SHELF[0]], unresolved=SHELF[1:]),
        "key-first",
    )
    store.commit(
        ShelfResult(walk=WALK, location=BAY, confirmed=SHELF[:3], unresolved=SHELF[3:]),
        "key-second",
    )
    shelves = [s for s in store.shelves(WALK) if s.location == BAY]
    assert len(shelves) == 1
    assert shelves[0].confirmed == SHELF[:3]


def test_printed_sheets_are_registered_with_their_counts(store):
    sheet = Sheet(
        id=f"{BAY}-2026-08-17-1",
        walk=WALK,
        location=BAY,
        printed_at="2026-08-17",
        members=list(SHELF),
    )
    store.record_sheets([sheet])

    registered = store.sheets(BAY)
    assert len(registered) == 1
    assert registered[0].members == list(SHELF)
    assert len(registered[0].members) == len(SHELF)


def test_a_plaintext_instance_is_refused_rather_than_warned_about():
    # PKCE over plaintext provides nothing at all, so this is a hard failure.
    with pytest.raises(ValueError):
        ServiceNowStore("http://insecure.invalid", "Bearer t")
    with pytest.raises(ValueError):
        ServiceNowStore("ftp://insecure.invalid", "Bearer t")


def test_the_servicenow_adapter_sends_confirmations_and_not_removals():
    store, instance = servicenow_store()
    instance.roster = list(SHELF)
    store.commit(
        ShelfResult(
            walk=WALK,
            location=BAY,
            confirmed=[SHELF[0], SHELF[1]],
            unresolved=[SHELF[2]],
            new_devices=["UOM999999"],
        ),
        "key-mapping",
    )

    (scan,) = instance.scans
    # `scanned` is the only field that flips a roster row, and the unresolved
    # asset is not in it. It travels under `unresolved` so the scoped app can
    # record what the shelf failed to account for — which is not a removal, and
    # leaves the roster row false, ServiceNow's own way of saying "not found".
    assert scan["scanned"] == [SHELF[0], SHELF[1]]
    assert SHELF[2] not in scan["scanned"]
    assert scan["unresolved"] == [SHELF[2]]
    # A device nobody expected is reported for triage, never auto-created.
    assert scan["unexpected"] == ["UOM999999"]


def test_the_servicenow_adapter_carries_the_callers_own_token():
    # This process holds no credential of its own; writes run as the auditor.
    store, instance = servicenow_store()
    seen = {}

    def capture(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("Authorization")
        return instance.handle(request)

    store.client = httpx.Client(
        base_url="https://example.invalid",
        headers={"Authorization": "Bearer auditor-token"},
        transport=httpx.MockTransport(capture),
    )
    store.roster(WALK)
    assert seen["auth"] == "Bearer auditor-token"


def test_a_new_audit_starts_empty_and_is_listed(store):
    store.create_walk("walk-new")

    listed = {walk.id: walk for walk in store.walks()}
    assert "walk-new" in listed
    # It covers nothing until shelves are added, and that is a normal state to
    # be in — it is the audit somebody has just created.
    assert listed["walk-new"].locations == []


def test_a_shelf_added_to_an_audit_appears_with_its_orientation(store):
    store.create_walk("walk-new")
    store.add_location("walk-new", Location(id="BAY-Z9", orientation="horizontal"))

    covered = {walk.id: walk for walk in store.walks()}["walk-new"].locations
    assert [(c.id, c.orientation) for c in covered] == [("BAY-Z9", "horizontal")]
    # Orientation is not decoration: it decides whether this shelf is walked by
    # sticky note or by printed QR sheet.
    assert "BAY-Z9" in [location.id for location in store.locations()]


def test_adding_an_existing_shelf_brings_its_history_with_it(store):
    store.create_walk("walk-second")
    store.add_location("walk-second", Location(id=BAY, orientation="vertical"))

    # The point of picking a shelf from the catalogue rather than typing a new
    # name: the second audit walks against what the first one recorded.
    assert [position.asset for position in store.history(BAY)] == SHELF
    assert sorted(entry.asset for entry in store.roster("walk-second")) == sorted(SHELF)


def test_a_walked_shelf_is_marked_walked(store):
    before = {c.id: c.walked for c in _covered(store, WALK)}
    assert before[BAY] is False

    store.commit(
        ShelfResult(walk=WALK, location=BAY, confirmed=[SHELF[0]], unresolved=SHELF[1:]),
        "key-walked",
    )

    after = {c.id: c.walked for c in _covered(store, WALK)}
    assert after[BAY] is True


def test_removing_a_shelf_leaves_the_shelf_and_its_history_alone(store):
    store.remove_location(WALK, BAY)

    assert [c.id for c in _covered(store, WALK)] == []
    # Dropped from the audit, not dismantled: the recorded order survives and
    # the shelf can be added to another audit.
    assert [position.asset for position in store.history(BAY)] == SHELF
    assert BAY in [location.id for location in store.locations()]


def _covered(store, walk_id: str) -> list[Location]:
    return next(walk.locations for walk in store.walks() if walk.id == walk_id)
