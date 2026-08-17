"""The AssetWalk domain, modelled on the physical act rather than on any
vendor's schema.

Mirroring ``sn_hamp_m2m_audit_asset`` here would bake ServiceNow's shape into
everything and fight every future adapter, so the translation happens once, in
adapters/servicenow.py, and nowhere else.

These are pydantic models because FastAPI already depends on pydantic — using
it costs nothing in the dependency tree, and hand-rolling the same checks would
only add code for a reviewer to read.
"""

from typing import Annotated

from pydantic import BaseModel, Field

# The same shapes the client validates at its own boundary. An asset tag is an
# optional short site prefix followed by digits; identifiers are opaque. These
# are applied to every tag the server accepts, including the ones inside lists:
# a malformed tag that reaches the store is a corrupted audit record.
Tag = Annotated[str, Field(pattern=r"^[A-Za-z]{0,4}[0-9]{4,10}$")]
Ident = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")]


class Position(BaseModel):
    """A slot in a shelf's history: this asset, at this sequence, here."""

    location: Ident
    sequence: Annotated[int, Field(ge=0)]
    asset: Tag


class RosterEntry(BaseModel):
    """An asset this walk expects to find. ``location`` is where it was last
    seen, which is a hint for reconciliation and nothing more."""

    asset: Tag
    location: Ident | None = None


class ShelfResult(BaseModel):
    """One walk of one shelf, as the client's reducer left it.

    ``unresolved`` is not a list of removals. It is what this shelf could not
    account for, and most of it turns up confirmed on another shelf.
    """

    walk: Ident
    location: Ident
    confirmed: list[Tag] = Field(default_factory=list)
    unresolved: list[Tag] = Field(default_factory=list)
    new_devices: list[Tag] = Field(default_factory=list)
    unreadable: Annotated[int, Field(ge=0)] = 0


class Sheet(BaseModel):
    """A printed QR substack sheet, and what it claims is underneath it."""

    id: Ident
    walk: Ident
    location: Ident
    printed_at: str
    members: list[Tag] = Field(default_factory=list)


class Relocation(BaseModel):
    asset: Tag
    expected_at: Ident
    found_at: Ident


class Candidate(BaseModel):
    """Unresolved audit-wide. The only population where "removed" is a
    defensible answer, and even then a human decides."""

    asset: Tag
    location: Ident


class Reconciliation(BaseModel):
    relocated: list[Relocation] = Field(default_factory=list)
    candidates: list[Candidate] = Field(default_factory=list)
    new_devices: list[Tag] = Field(default_factory=list)
    unreadable: int = 0

