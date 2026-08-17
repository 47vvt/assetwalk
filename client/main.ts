// App shell: fetches one shelf, runs the walk, sends the result, forgets the
// shelf. The order of those last two is the point of §5 — the history slice
// exists in this module's local variables and nowhere else, and it is dropped
// the moment the confirmations are safely queued.

import { assetTag, locationID, walkID } from './core/types.js';
import type { AssetTag, LocationID, WalkID } from './core/types.js';
import { begin, reduce, result } from './core/walk.js';
import type { Event, State } from './core/walk.js';
import { parseConfig } from './io/parse.js';
import { oauthFrom, signIn } from './io/auth.js';
import {
  addLocation,
  createWalk,
  drain,
  fetchHistory,
  fetchLocations,
  fetchRoster,
  fetchWalks,
  pendingCount,
  queueSheets,
  queueShelf,
  removeLocation,
} from './io/server.js';
import type { Backend } from './io/server.js';
import { confirmScan, rejectScan } from './platform/haptics.js';
import { openCamera, scanningAvailable } from './platform/scanner.js';
import type { Camera } from './platform/scanner.js';
import { DEMO_HISTORY, DEMO_LOCATION, DEMO_ROSTER, DEMO_WALK } from './demo-shelf.js';
import { button, el, replace } from './ui/dom.js';
import { renderAudits, renderNewAudit, renderShelves } from './ui/audits-view.js';
import { renderSheets } from './ui/sheets-view.js';
import { renderScan } from './ui/scan-view.js';
import { renderWalk } from './ui/walk-view.js';

const host = window.document.body;

// Null in standalone demo mode. Everything that would reach the network is
// guarded on it, so opening index.html with no walk in the URL makes no
// requests at all — which is what a reviewer opens and what gets demoed.
let backend: Backend | null = null;
let state: State | null = null;
let misses = 0;
// Non-null exactly while the scan screen is up. Scanning is a screen, not an
// overlay: the camera replaces the window, and every event re-renders whichever
// screen the auditor is actually on.
let camera: Camera | null = null;
let ambiguous: readonly string[] = [];
let torch = false;
let syncing = false;

// One drain loop at a time. Each shelf completion would otherwise start
// another, and several loops backing off independently turn one flaky link
// into a burst of retries.
function sync(): void {
  if (backend === null || syncing) return;
  syncing = true;
  const here = backend;
  void drain(here, new AbortController().signal).finally(() => {
    syncing = false;
  });
}

async function load(): Promise<void> {
  // No config.json at all means nobody has deployed this — it is a checkout
  // being opened in a browser. Run on the fixture rather than failing, because
  // that is what a reviewer does first and what gets demoed.
  const config = await fetch('./config.json')
    .then((response) => (response.ok ? response.json() : null))
    .then((raw) => (raw === null ? null : parseConfig(raw)))
    .catch(() => null);

  if (config === null) {
    state = begin(DEMO_WALK, DEMO_LOCATION, DEMO_HISTORY, DEMO_ROSTER);
    return render();
  }

  // A standalone SQLite deployment has nothing to sign in to, so it goes
  // straight to the audits. Otherwise sign-in is behind a button, because
  // browsers only open the authorisation window from a user gesture and PKCE
  // needs that window in order to keep the verifier out of storage.
  if (config.oauth === null) {
    backend = { base: config.backend, token: null };
    return route();
  }

  const { instance, clientID } = config.oauth;
  replace(
    host,
    el('header', {}, el('h1', {}, 'AssetWalk')),
    button('Sign in', () => void start(config.backend, instance, clientID), 'finish wide'),
  );
}

async function start(base: string, instance: string, clientID: string): Promise<void> {
  const callback = new URL('./callback.html', window.location.href).href;
  backend = { base, token: await signIn(oauthFrom(instance, clientID, callback)) };
  return route();
}

// The URL is the screen. A walk in progress survives a reload, a shelf can be
// linked to, and the back button does what it looks like it does.
async function route(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const walk = walkID(params.get('walk') ?? '');
  const location = locationID(params.get('location') ?? '');

  if (walk === null) return audits();
  if (location === null) return shelves(walk);
  return open(walk, location);
}

function go(params: string): void {
  window.history.pushState(null, '', params === '' ? window.location.pathname : `?${params}`);
  void route();
}

// The URL is the screen, so the browser's own back button has to move between
// them. Without this it would change the address and leave the page showing
// the screen it was already on.
window.addEventListener('popstate', () => void route());

async function audits(): Promise<void> {
  if (backend === null) return;
  renderAudits(host, await fetchWalks(backend), auditHandlers);
}

const auditHandlers = {
  open: (walk: WalkID) => go(`walk=${encodeURIComponent(walk)}`),
  compose: () => renderNewAudit(host, auditHandlers),
  create: (walk: WalkID) => void createAudit(walk),
  cancel: () => void audits(),
};

async function createAudit(walk: WalkID): Promise<void> {
  if (backend === null) return;
  await createWalk(backend, walk);
  // Straight to its shelf list, because an audit that covers nothing is not
  // finished being created.
  go(`walk=${encodeURIComponent(walk)}`);
}

async function shelves(walk: WalkID): Promise<void> {
  const here = backend;
  if (here === null) return;
  const [walks, known] = await Promise.all([fetchWalks(here), fetchLocations(here)]);
  const audit = walks.find((candidate) => candidate.id === walk);
  if (audit === undefined) return audits();

  renderShelves(host, audit, known, {
    walk: (location) =>
      go(`walk=${encodeURIComponent(walk)}&location=${encodeURIComponent(location)}`),
    add: (id, orientation) => void change(walk, () => addLocation(here, walk, { id, orientation })),
    remove: (location) => void change(walk, () => removeLocation(here, walk, location)),
    back: () => go(''),
  });
}

async function change(walk: WalkID, edit: () => Promise<void>): Promise<void> {
  await edit();
  await shelves(walk);
}

async function open(walk: WalkID, location: LocationID): Promise<void> {
  if (backend === null) return;
  const [roster, history] = await Promise.all([
    fetchRoster(backend, walk),
    fetchHistory(backend, location),
  ]);
  state = begin(walk, location, history, new Set(roster.map((entry) => entry.asset)));
  render();
}

function dispatch(event: Event): void {
  if (state === null) return;
  // The stall nudge counts consecutive unrecognised devices. It lives here and
  // not in the reducer on purpose: it is a hint about the auditor, and it must
  // never influence how a device is classified.
  misses = event.kind === 'IDENTIFY' ? misses + 1 : 0;
  state = reduce(state, event);
  render();
}

function render(): void {
  if (state === null) return;
  // The same three actions on both screens; only the first one's job differs.
  const handlers = {
    dispatch,
    toggleScan: () => (camera === null ? void openScan() : closeScan()),
    finish: () => void finish(),
  };

  if (camera !== null) {
    const live = camera;
    renderScan(host, state, live, torch, ambiguous, {
      ...handlers,
      choose: (value) => {
        ambiguous = [];
        accept(value);
      },
      toggleTorch: () => {
        torch = !torch;
        render();
        void live.setTorch(torch).catch(() => {
          // A device can advertise the torch constraint and still refuse it.
          // Put the label back rather than leaving it claiming a light that
          // is not on.
          torch = false;
          render();
        });
      },
    });
    return;
  }
  renderWalk(host, state, misses, pendingCount(), handlers);
}

// One barcode read locates the cursor in history definitively, which is why
// this is a screen of its own rather than an item in a menu: it is where an
// auditor goes when they have lost their place, and where they stay until they
// have found it again.
async function openScan(): Promise<void> {
  if (!scanningAvailable()) {
    replace(
      host,
      el('header', {}, el('h1', {}, 'Scanning unavailable')),
      el(
        'p',
        {},
        'This browser has no barcode reader. Type the tag from the note instead — ' +
          'the walk does not need a barcode to finish.',
      ),
      button('Back', render, 'primary'),
    );
    return;
  }

  camera = await openCamera((event) => {
    if (event.kind === 'AMBIGUOUS') {
      rejectScan();
      ambiguous = event.values;
      render();
      return;
    }
    ambiguous = [];
    accept(event.value);
  });
  render();
}

function closeScan(): void {
  stopCamera();
  render();
}

function stopCamera(): void {
  camera?.stop();
  camera = null;
  ambiguous = [];
  torch = false;
}

function accept(raw: string): void {
  const tag = assetTag(raw);
  if (tag === null) {
    rejectScan();
    return;
  }
  void confirmScan();
  dispatch({ kind: 'IDENTIFY', tag });
}

async function finish(): Promise<void> {
  if (state === null) return;
  const finished = result(state);
  const walked = [...finished.confirmed];
  const walk = state.walk;
  const location = state.location;

  // Finish is reachable from the scan screen too, so the camera is released
  // before the walk state it belongs to goes away.
  stopCamera();
  if (backend !== null) queueShelf(finished);
  // The history slice is dropped here: immediately after the confirmations are
  // durable, and before anything else can take a reference to it. The device
  // now holds one shelf's worth of tags rather than the site's.
  state = null;
  sync();

  complete(walk, location, walked);
}

function complete(walk: WalkID, location: LocationID, walked: readonly AssetTag[]): void {
  replace(
    host,
    el('header', {}, el('h1', {}, `${location} complete`)),
    el(
      'p',
      {},
      backend === null
        ? `${walked.length} devices confirmed. Standalone demo — nothing was sent anywhere.`
        : `${walked.length} devices confirmed and queued.`,
    ),
    // What could not be accounted for is deliberately not shown and not asked
    // about. Whether a tag is a removal depends on every other shelf in the
    // audit, which this device does not have and is not going to be given —
    // the variance report is produced once the whole walk is in.
    el('p', { class: 'empty' }, 'Anything unaccounted for is settled audit-wide, after every shelf is in.'),
    // A horizontal stack is walked with the same reducer; all that differs is
    // what happens at the end, because Algorithm 2's mechanism is the paper.
    button('Print QR sheets for this stack', () => offerSheets(walk, location, walked), 'primary'),
    // The fixture has no audit behind it and so nowhere to go back to.
    backend === null
      ? ''
      : button('Back to shelves', () => go(`walk=${encodeURIComponent(walk)}`), 'finish'),
  );
}

function offerSheets(walk: WalkID, location: LocationID, walked: readonly AssetTag[]): void {
  renderSheets(host, walk, location, walked, (sheets) => {
    if (backend !== null) queueSheets(location, sheets);
    sync();
    complete(walk, location, walked);
  });
}

void load();
