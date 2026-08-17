# ServiceNow HAM Pro integration

Everything here is instance-side work. None of it lives in this repository,
and no instance hostname, client ID or key ever should.

## The key insight

`sn_hamp_m2m_audit_asset` is a **pre-populated roster, not a scan log**. It has
one row per expected asset and a `scanned` boolean that defaults to false. You
are **updating existing rows**, never appending.

That single fact decides the entire write mapping:

| Reducer outcome | ServiceNow action |
|---|---|
| confirmed | flip `scanned = true` on the existing roster row |
| relocated | flip `scanned = true` — it was found, and that is the whole fact |
| removed | **write nothing.** The row stays `scanned = false`, which is already ServiceNow's representation of "expected but not found" |
| new asset | not on the roster, so there is no row to flip. Report for triage; never auto-create |

Writing a removal would invent a second representation of a fact ServiceNow
already records, and two representations of one fact can disagree.

## Custom tables

**Neither algorithm works without these.** ServiceNow's audit table has no
concept of shelf, order or grouping.

```
u_audit_location    shelf/bay, orientation (vertical|horizontal)
u_audit_position    location, sequence, asset, last_confirmed_audit
u_audit_sheet       sheet_id, location, member tags, count, printed_at
```

These need a scoped app and a change request. **Longest lead-time item in the
project — raise it first.** The client never touches them; only
`server/adapters/servicenow.py` does.

## Scripted REST API

One scoped endpoint takes a whole batch. It resolves tags against
`alm_hardware`, updates the m2m rows, and maintains `u_audit_position`. One
round trip per sync, idempotency keys so retries do not duplicate, one place to
enforce validation.

It is also code the organisation's own ServiceNow team reads and change-manages
inside their own instance, which is the strongest verifiability argument
available here — it asks nobody to trust this repository.

### `POST /api/x_assetwalk/scan`

Header `Idempotency-Key` is required. A repeated key must be a no-op.

```jsonc
{
  "audit": "<asset_audit sys_id or number>",
  "location": "BAY-A3",
  "scanned": ["UOM270313", "..."],   // flip scanned = true, in walked order
  "unresolved": ["UOM420696"],       // recorded; flips nothing
  "unexpected": ["UOM999999"],       // reported for triage; creates nothing
  "positions": [[0, "UOM270313"]],   // replaces u_audit_position for location
  "unreadable": 1
}
```

There is no endpoint for recording a removal, deliberately. A roster row left
at `scanned = false` is already ServiceNow's representation of "expected and
not found", and reconciliation is a report rather than a workflow — nobody is
asked to click "removed", least of all the person who walked the shelf an hour
ago.

### `GET /api/x_assetwalk/shelves?audit=<id>`

Returns the shelf results committed to this audit, so cross-shelf
reconciliation can run without a device ever holding the full picture.

Check **"Run business rules"** on the transform so audit status recalculation
triggers automatically.

The exact behaviour both endpoints must honour is written out executably in
`server/tests/test_store_contract.py`, in the `Instance` class. That is the
specification; the same suite runs against SQLite and against this adapter.

## Auth

OAuth Authorization Code + PKCE, client-direct to the instance. Register an
OAuth API endpoint for external clients as a **public client** — no secret,
which is the only correct choice for code in a public repository.

The backend holds no credentials. The auditor's own bearer token arrives with
each request and is passed straight through, so writes run as the auditor,
under the auditor's ACLs, and a compromise of the backend leaks no standing
access.

If the organisation federates to Okta or Entra, ServiceNow redirects on its
own — never touch SAML directly.

## Validation still outstanding

- [ ] Confirm actual column names via the **data dictionary**
      (`sys_dictionary.list` filtered to `name=sn_hamp_m2m_audit_asset`) —
      **not display labels.** Field names vary by HAM Pro version. They are
      gathered at the top of `server/adapters/servicenow.py` so this is one diff.
- [ ] Verify which business rules watch the `scanned` field
- [ ] **Verify the instance version supports PKCE.** Older releases do not
- [ ] Validate on sub-prod with a small batch before any full run
- [ ] Configure CORS rules (`sys_cors_rule`) for the client origin
- [ ] Confirm auditor ACLs allow write on the m2m table
- [ ] Scan an existing asset tag and confirm its symbology before deciding
      anything about label printing
