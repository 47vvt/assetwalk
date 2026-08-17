"""HTTP surface.

Narrow by design: this is a data-scoping and integration tier, not where the
logic lives. The reducer, PDF and QR generation, auth, and the decision about
what counts as a removal are all somewhere else — the first three in the
client, the last in reconcile.py.

No instance hostname, client ID or key appears here or anywhere else in the
repository. Everything is injected at deploy time through the environment.
"""

import os
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Response

from adapters.servicenow import ServiceNowStore
from adapters.sqlstore import SqlStore
from domain import Decision, Position, Reconciliation, RosterEntry, Sheet, ShelfResult
from reconcile import reconcile
from store import Store

app = FastAPI(title="AssetWalk", docs_url=None, redoc_url=None)

BACKEND = os.environ.get("ASSETWALK_STORE", "sqlite")
DB_PATH = os.environ.get("ASSETWALK_DB", "assetwalk.db")
INSTANCE = os.environ.get("ASSETWALK_INSTANCE_URL", "")

_sqlite = SqlStore(DB_PATH) if BACKEND == "sqlite" else None


def store_for(authorization: Annotated[str | None, Header()] = None) -> Store:
    """One store per request.

    Against ServiceNow the caller's own bearer token is passed straight
    through, so writes run as the auditor under the auditor's ACLs and this
    process never holds a credential of its own.
    """
    if _sqlite is not None:
        return _sqlite
    if not authorization:
        raise HTTPException(401, "ServiceNow backend requires the caller's bearer token")
    return ServiceNowStore(INSTANCE, authorization)


Bound = Annotated[Store, Depends(store_for)]


@app.get("/api/walks/{walk_id}/roster")
def roster(walk_id: str, store: Bound) -> list[RosterEntry]:
    return store.roster(walk_id)


@app.get("/api/locations/{location_id}/history")
def history(location_id: str, store: Bound) -> list[Position]:
    """One shelf, never the site.

    This scoping is the reason the backend exists at all: the device ends up
    holding ~40 asset tags for the duration of one shelf instead of the site's
    full positional history indefinitely.
    """
    return store.history(location_id)


@app.post("/api/walks/{walk_id}/shelves", status_code=204)
def commit_shelf(
    walk_id: str,
    result: ShelfResult,
    store: Bound,
    idempotency_key: Annotated[str | None, Header()] = None,
) -> Response:
    if not idempotency_key:
        raise HTTPException(400, "Idempotency-Key header is required")
    if result.walk != walk_id:
        raise HTTPException(400, "shelf result does not belong to this walk")
    store.commit(result, idempotency_key)
    return Response(status_code=204)


@app.get("/api/walks/{walk_id}/reconciliation")
def reconciliation(walk_id: str, store: Bound) -> Reconciliation:
    """Runs across every shelf committed to this walk.

    Anything unresolved on one shelf but confirmed on another comes back as
    relocated, not removed. Only tags unresolved audit-wide reach the auditor
    as removal candidates.
    """
    return reconcile(store.shelves(walk_id))


@app.post("/api/walks/{walk_id}/reconciliation", status_code=204)
def resolve(walk_id: str, decisions: list[Decision], store: Bound) -> Response:
    """Record the auditor's answers.

    A ``removed`` decision writes nothing to the system of record on purpose:
    the roster row is already false, which is ServiceNow's representation of
    "expected and not found". Re-stating it in a second place would create two
    versions of the same fact that can disagree.
    """
    store.resolve(
        walk_id,
        found=[d.asset for d in decisions if d.decision == "found"],
        removed=[d.asset for d in decisions if d.decision == "removed"],
    )
    return Response(status_code=204)


@app.post("/api/locations/{location_id}/sheets", status_code=204)
def register_sheets(location_id: str, sheets: list[Sheet], store: Bound) -> Response:
    if any(sheet.location != location_id for sheet in sheets):
        raise HTTPException(400, "sheet does not belong to this location")
    store.record_sheets(sheets)
    return Response(status_code=204)


@app.get("/api/locations/{location_id}/sheets")
def printed_sheets(location_id: str, store: Bound) -> list[Sheet]:
    return store.sheets(location_id)
