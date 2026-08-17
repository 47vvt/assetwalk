# AssetWalk

Open-source physical asset auditing. Algorithmic and heuristic solutions for
verifying physical inventory quickly, with pluggable backends.

A full store audit should be completable by one person with a scanner, without
opening boxes or moving devices. That is the whole problem, and it is a
physical problem before it is a software one.

---

## The problem

Laptops are stacked on shelves like books. The barcode is at the centre-bottom
of each one, unreachable without pulling the device out — and pulling out forty
devices is how a two-hour audit becomes a two-day one. What faces the auditor
is a **handwritten sticky note** with the asset tag on it.

So: complete the audit by reading sticky notes only, and never pull a device out.

The first walk scans everything in order, top-left to bottom-right, and that
establishes a history. Every later walk assumes the order is *mostly* unchanged
— some additions, some removals, some devices shuffled within the shelf.

## Algorithm 1 — vertical shelves, by sticky note

**The core insight: a window miss is not a decision point.**

The auditor sees the next three entries from history. When the device in hand
is not among them, there are two possible reasons, and they are
indistinguishable at that moment:

- it is a brand-new device, or
- it is sitting further down the history, behind a run of removals.

Any design that asks the auditor to tell those apart is asking them to guess.
So AssetWalk never asks. **Identification does the classifying**, afterwards.

Two primitives, and nothing else:

1. **Tap one of the three on screen** → confirm it. Anything stepped over falls
   into the pile.
2. **Type the tag from the note and press Enter** → a four-step lookup resolves
   it. There is no second screen and no menu of what the audit already knows:
   one field, and the algorithm decides.

   The site prefix is a label rather than something to type — it is identical
   on every device in the building — and it is derived from the walk's own tags
   rather than configured. What is left goes in one cell per digit, so the
   auditor can check what they entered against a handwritten note at a glance
   instead of reading back a run of identical-looking numerals. Filling the
   last cell submits: there is no button, because the row is either complete or
   it is not.

**Undo.** The device just confirmed stays on screen, faint, and one button
takes back the last action — a tapped entry, a typed tag, or a scan. People
tapping fast mis-tap, and a wrong confirmation is otherwise silent: nothing
later in the walk reveals it, and the run it swept into the pile stays
unresolved for the rest of the audit. Undoing a confirmation puts that run back
in the window.

**Scanning is a screen, not a one-shot.** A barcode read locates the cursor in
history definitively, so it is where an auditor goes when they have lost their
place — and they stay there until they have found it. The camera replaces the
window; the last confirmed device and the tag field sit underneath it, because
the job has not changed, only how the label is being read. A frame with several
codes in it never resolves itself: stacked devices sit close together, and
taking the first one silently marks the wrong asset scanned.

| | Where it is found | What it means |
|---|---|---|
| 1 | In the pile | Moved within this shelf. Restore and confirm. |
| 2 | Further down this shelf's history, at index `k` | The entries in between were stepped over. Jump the cursor to `k+1` and sweep `history[cursor..k-1]` into the pile **in one move**. |
| 3 | On the audit roster | A real asset, relocated from another shelf. |
| 4 | Nowhere | Genuinely new. Insert here; touch nothing else. |

Order matters. Resolving a step 1 as a step 4 invents a phantom removal *and* a
phantom new device out of a single tap.

Step 2 is what makes this fast: **a run of six removals costs one interaction,
not six.** There is a test asserting exactly that.

The auditor is never shown which of the four steps fired, and never shown the
shelf's history to pick from. Both would invite them to answer the question the
algorithm exists to avoid asking.

### Nothing is marked removed during a walk

The pile is **never populated by an auditor action** — it fills only as a side
effect of cursor jumps. Nothing in it is a removal; it is unresolved.

Removal is decided at the end, **across all shelves**, on the server:

1. A tag unresolved on shelf A but confirmed on shelf C was **relocated**.
2. Only tags unresolved audit-wide are candidates for being genuinely gone.

Per-shelf removal decisions turn every internal move into a false removal plus
a false new asset. The reason the backend exists at all is that this decision
needs a global view — and doing it server-side means no device ever needs one.

**The outcome is a report, not a screen.** The app never asks the auditor to
mark anything removed, because an unexplained variance is an incident and the
person who walked the shelf an hour ago is the wrong person, at the wrong
moment, to close it. `GET /api/walks/{id}/reconciliation` and the CSV export
are where it surfaces.

## Algorithm 2 — horizontal stacks, by QR substack sheet

Laptops lying flat, barcodes underneath, unreachable without disassembling the
stack. The first walk scans everything; the client then generates **printable
QR sheets**, each placed at a substack boundary, each encoding the tags of the
10–20 devices below it.

This works because devices are only ever taken from the top. When devices go,
the sheet on top of them goes with them, and the next walk prints a new one.

- The QR encodes **the tags themselves**, never a lookup ID. A group ID fails
  in exactly the situation the audit happens in: different auditor, different
  device, cleared cache, no signal. A self-contained sheet works offline forever.
- The load-bearing assumption ("nobody reaches into the middle of a stack") is
  usually true and fails silently. Mitigation: a **count printed large**. The
  auditor counts the substack by eye in two seconds. Match → trust the group.
  Mismatch → that substack falls back to individual scanning.
- Sheets are printed after the walk and someone has to physically place them,
  so the PDF does that job: one sheet per page, with the location and
  `PLACE ABOVE UOM0012345` as the largest text on it.

---

## What a stranger can verify in about a minute

This project's primary selling point is that a security reviewer with no prior
context can read it and conclude it is neither malicious nor wrong. These are
the claims, and how to check each one without taking anyone's word for it.

### Dependencies

| | Count | Check |
|---|---|---|
| Client runtime (npm) | **0** | `jq .dependencies package.json` |
| Client dev (npm) | **1** — `typescript` | `jq .devDependencies package.json` |
| Client vendored files | **1** — `client/vendor/qr-encoder.ts` | `ls client/vendor` |
| Backend direct | **3** — `fastapi`, `uvicorn`, `httpx` | `grep -A5 dependencies server/pyproject.toml` |
| Backend transitive | 20 | `grep -c '^name = ' server/uv.lock` |

CI asserts all of these on every run, so the table cannot rot quietly.

### The one vendored file

`client/vendor/qr-encoder.ts` is Project Nayuki's QR generator (MIT). Lines
1–990 are **byte-identical to upstream**; the only local change is a
three-line export footer, because upstream declares a global namespace and this
project loads unbundled ES modules.

```sh
head -n 990 client/vendor/qr-encoder.ts | sha256sum
# 1dc03fb5a10e0e2318ea162755bbdb9977ca6ce52cff959e9c9b6deafdccda9c
sha256sum client/vendor/qr-encoder.ts
# 7e8cc4ebc98076bcca52fa0ecfa4b4ffe3da60539a8dc2c36e2f01afb88b95d5
```

Upstream: `nayuki/QR-Code-generator`, `typescript-javascript/qrcodegen.ts`.

QR encoding is Reed-Solomon over GF(256), BCH-coded format info, and mask
evaluation across eight candidates — about 1500 lines of dense numeric code
that cannot be meaningfully reviewed and is easy to get subtly wrong. Take it.
PDF writing is filled rectangles and byte offsets, so that is hand-written
here in 121 lines instead of a 300KB general-purpose library.

Vendored code is a separate TypeScript project (`client/vendor/tsconfig.json`)
so that our settings are never quietly relaxed to accommodate someone else's
file. Its trust comes from the hash above, not from passing our lint bar.

### It cannot send your scan data anywhere

`client/index.html` carries a strict Content-Security-Policy with
`connect-src 'self'`. Deployment rewrites that to the backend origin and the
configured ServiceNow instance, and that substitution is the only place an
instance hostname exists. One line to read; the rest of the client cannot
escape it.

### No secrets, ever

No instance URL, client ID, signing key or environment config is in this
repository. `client/config.json` is written by the deployment and is
gitignored; `client/config.example.json` is the template. CI fails the build if
an instance hostname appears anywhere in the tree.

### Size

The volume of code is itself part of the threat surface: a reviewer's attention
is finite, and code they skim is code they have not audited. Non-comment,
non-blank lines:

| Component | Budget | Actual |
|---|---|---|
| `client/core` — reducer, sheets, domain | ~400 | **226** |
| `client/io/parse.ts` — validation boundary | ~50 | **65** |
| `client/io/auth.ts` — PKCE | ~100 | **76** |
| `client/io/server.ts` — fetches, offline queue | — | **105** |
| `client/pdf` — writer and sheet layout | ~250 | **121** |
| `client/platform` — capability adapters | ~150 | **125** |
| `client/ui` + `main.ts` + demo fixture | — | **507** |
| `server` — the whole backend | ~600 | **561** |
| Tests (client 506, server 417) | — | **923** |

More test code than application code in the parts where being wrong is silent.
That is deliberate.

---

## Running it

### The client, standalone, no backend

```sh
npm ci
npm run build
python3 -m http.server 8000 --directory client
```

Open `http://localhost:8000`. With no `?walk=` in the URL the client runs
entirely on a built-in fixture and **makes no network requests at all**. That
is the demo, and it is what a reviewer should open first.

Tap entries, type a tag that is not on screen and press Enter, finish the
shelf, download a QR sheet PDF.

### Tests

```sh
npm run check                   # build, then the client suite (node:test)
cd server && uv run pytest -q   # the backend suite
```

### A whole audit, standalone — and the variance report

Reconciliation needs *every* shelf in the walk, so the single-shelf fixture
cannot produce one. Run the real thing instead — no ServiceNow instance, no
sign-in:

```sh
npm ci && npm run build

cd server
uv sync
printf '{ "backend": "/api" }\n' > ../client/config.json   # no instance,
                                                          # no sign-in
uv run python cli.py import walk-demo example-walk.csv
uv run uvicorn main:app --port 8000
```

The backend serves the client too, so everything is one origin and
`connect-src 'self'` stays literally true with no CORS rules anywhere.

Then walk **two** shelves, because that is what makes reconciliation mean
something:

1. `http://localhost:8000/index.html?walk=walk-demo&location=BAY-A3` — confirm
   a few devices, leave others unfound, then **Finish shelf**.
2. `http://localhost:8000/index.html?walk=walk-demo&location=BAY-B1` — this
   shelf holds `UOM220126`, which the sample data lists on A3. Type it into the
   field and press Enter to record it here.

Then read the outcome:

```sh
uv run python cli.py export walk-demo
# asset,outcome,expected_at,found_at
# UOM220126,relocated,BAY-A3,BAY-B1
# UOM420696,not_found,BAY-A3,
```

`UOM220126` comes back as a **relocation, not a variance** — it was unresolved
on A3 and confirmed on B1. Only tags nobody found anywhere are reported as not
found. `GET /api/walks/walk-demo/reconciliation` returns the same thing as JSON.

Standalone SQLite is **not a mock**. Many organisations have this exact
physical audit problem and no ITAM platform at all; SQLite plus CSV import and
export is a real deployment mode, and the easiest way to try the project.

### Against ServiceNow

Keep `instance` and `clientID` in `config.json` and set
`ASSETWALK_STORE=servicenow` plus `ASSETWALK_INSTANCE_URL=https://…` on the
backend. The client then shows a sign-in button and runs the PKCE flow
described in `docs/servicenow.md`.

### Generating an SBOM

```sh
npx --yes @cyclonedx/cyclonedx-npm --output-file sbom.json
```

Not committed, for the same reason `dist/` is not: a generated artifact in the
tree rots and a reviewer cannot tell whether it matches the source beside it.

---

## Layout

```
client/
  core/        reducer, sheet planning, domain types — pure, no I/O, no vendor names
  io/          validation boundary, PKCE, backend client and offline queue
  pdf/         hand-written PDF writer and QR sheet layout
  platform/    camera and haptics — the only native-aware code
  ui/          four screens of lists and buttons, no framework
  vendor/      qr-encoder.ts, pinned and hash-documented
  test/        node:test, no framework
server/
  adapters/    servicenow (production), sqlstore (dev, test, standalone), csvio
native/        capacitor shell — committed and near-empty, deliberately
docs/          servicenow.md — the instance-side work
```

`client/core` knows nothing about ServiceNow. Roster in, decisions out. **If a
`sn_hamp_` field name ever appears inside `client/core`, that is a bug.**

## Build discipline

`tsc` strips types and does nothing else. No downlevelling, no bundling, no
minification, and `erasableSyntaxOnly` makes that a compile error rather than a
convention: TypeScript syntax that emits code instead of erasing (enums,
namespaces, parameter properties) is rejected.

Emitted `.js` is therefore the `.ts` with type annotations and type-only
declarations removed, and nothing else. Structure, names and comments survive.
Line numbers shift where whole-line type declarations were removed, which is
what the shipped source maps are for.

`dist/` is **not committed** — committed build output rots and reviewers cannot
tell whether it matches. CI rebuilds with the pinned compiler and asserts the
output is byte-identical across two builds.

`noUncheckedIndexedAccess` is on. The reducer indexes into `history[]`
constantly, and an off-by-one at a shelf boundary is precisely the bug class it
catches.

## How correctness is checked

Silent audit corruption is undetectable in production: a wrong record looks
exactly like a right one. So the reducer is **property-tested by fuzzing** —
generate a shelf history, apply random mutations (remove a run, insert, swap
adjacent, move within the shelf, relocate from another shelf), simulate a
perfect auditor, and assert the reconstruction matches the mutation applied:

- confirmations are exactly the physical order walked,
- unresolved is exactly `history − shelf`, no more and no less,
- only devices on no roster anywhere are called new.

400 seeded cases per run, replayable from the seed printed with any failure.
`client/test/walk.test.ts` also replays the reference implementation's own
example and asserts the same answer.

The storage layer has **one contract suite run against both stores**
(`server/tests/test_store_contract.py`). The ServiceNow case runs against a
transport stub that answers the way the instance does, which is how that
adapter stays honest without a live instance — and it already caught one real
divergence between the two.

## Known gaps

- **No ZXing fallback yet.** Scanning uses the native `BarcodeDetector` and
  feature-detects; where it is absent the scan screen says so and the walk
  continues on typed tags, which is a first-class path rather than a degraded
  one — the point of Algorithm 1 is finishing an audit without reaching a
  barcode at all. Vendoring `@zxing/library` for older iOS is not done.
- **A present-but-unreadable device cannot be recorded as such.** A faded
  sticky note and a missing laptop are different facts that look identical
  during a walk, and both now land in the same unresolved bucket in the
  variance report.
- **No Capacitor shell.** Step 6 of the build order, and deliberately last:
  scaffold native first and native assumptions leak into the core, permanently
  losing the browser-auditable property. Nothing yet requires it — see
  `native/README.md` for the two things that would.
- The ServiceNow scoped app and its scripted endpoints are specified in
  `docs/servicenow.md` and pinned executably by the contract suite, but they
  are instance-side work and are not in this repository.

## Principles

- **Unexplained inventory variance is an incident, not a data-entry
  correction.** Reconciliation is designed accordingly.
- Collapse edge cases into clean invariants rather than accumulating heuristic
  patches. Every heuristic in the first draft of Algorithm 1 was eliminated by
  finding the right invariant. **Treat a new heuristic as a signal the
  invariant is wrong.**
- Vendor logic lives in adapters. Core stays pure and I/O-free.
- Evaluate every decision against the auditability constraint *before* other
  factors.

## Licence

Apache-2.0. See `LICENSE` and `NOTICE`.
