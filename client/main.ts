// App shell: fetches one shelf, runs the walk, sends the result, forgets the
// shelf. The order of those last two is the point of §5 — the history slice
// exists in this module's local variables and nowhere else, and it is dropped
// the moment the confirmations are safely queued.

import { assetTag, locationID } from './core/types.js';
import type { AssetTag, LocationID, WalkID } from './core/types.js';
import { begin, reduce, result } from './core/walk.js';
import type { Event, State } from './core/walk.js';
import { parseConfig, parseWalkID } from './io/parse.js';
import { oauthFrom, signIn } from './io/auth.js';
import { drain, fetchHistory, fetchRoster, pendingCount, queueSheets, queueShelf } from './io/server.js';
import type { Backend } from './io/server.js';
import { confirmScan, rejectScan } from './platform/haptics.js';
import { openCamera, scanningAvailable } from './platform/scanner.js';
import type { Camera } from './platform/scanner.js';
import { DEMO_HISTORY, DEMO_LOCATION, DEMO_ROSTER, DEMO_WALK } from './demo-shelf.js';
import { button, el, replace } from './ui/dom.js';
import { renderSheets } from './ui/sheets-view.js';
import { renderWalk } from './ui/walk-view.js';

const host = window.document.body;

// Null in standalone demo mode. Everything that would reach the network is
// guarded on it, so opening index.html with no walk in the URL makes no
// requests at all — which is what a reviewer opens and what gets demoed.
let backend: Backend | null = null;
let state: State | null = null;
let misses = 0;
let camera: Camera | null = null;
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
  const params = new URLSearchParams(window.location.search);
  const walk = params.get('walk');
  const location = locationID(params.get('location') ?? '');

  // With no walk in the URL the client runs entirely on the fixture. That is
  // the standalone demo path, and it never touches the network.
  if (walk === null || location === null) {
    state = begin(DEMO_WALK, DEMO_LOCATION, DEMO_HISTORY, DEMO_ROSTER);
    return render();
  }

  // Config is fetched at runtime, never compiled in — the instance hostname
  // and client ID are not in this repository and cannot be.
  const id = parseWalkID(walk);
  const config = parseConfig(await (await fetch('./config.json')).json());

  // A standalone SQLite deployment has nothing to sign in to, so it starts
  // walking immediately.
  if (config.oauth === null) {
    backend = { base: config.backend, token: null };
    return open(id, location);
  }

  // Otherwise sign-in is behind a button, because browsers only open the
  // authorisation window from a user gesture and PKCE needs that window in
  // order to keep the verifier out of storage.
  const { instance, clientID } = config.oauth;
  replace(
    host,
    el('header', {}, el('h1', {}, 'AssetWalk')),
    el('p', {}, `Walk ${id} · ${location}`),
    button('Sign in', () => void start(config.backend, instance, clientID, id, location), 'finish'),
  );
}

async function start(
  base: string,
  instance: string,
  clientID: string,
  walk: WalkID,
  location: LocationID,
): Promise<void> {
  const callback = new URL('./callback.html', window.location.href).href;
  backend = { base, token: await signIn(oauthFrom(instance, clientID, callback)) };
  return open(walk, location);
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
  renderWalk(host, state, misses, pendingCount(), {
    dispatch,
    scan: () =>
      void openScanner('Scan to re-anchor', (tag) => dispatch({ kind: 'IDENTIFY', tag }), render),
    finish: () => void finish(),
  });
}

// One barcode scan locates the cursor in history definitively, which is why
// this is a button on the walk screen rather than an item in a menu: it is the
// recovery path when the auditor has lost their place. Reconciliation reuses
// it for the device whose note could not be read.
//
// `back` re-renders whichever screen opened the scanner. It is a callback and
// not a saved copy of the DOM, because a cloned node keeps none of its event
// listeners and a screen whose buttons quietly stop working is worse than one
// that never appeared.
async function openScanner(
  title: string,
  onTag: (tag: AssetTag) => void,
  back: () => void,
): Promise<void> {
  if (!scanningAvailable()) {
    replace(
      host,
      el('header', {}, el('h1', {}, 'Scanning unavailable')),
      el('p', {}, 'This browser has no barcode reader. Type the tag from the note instead.'),
      button('Back', back, 'primary'),
    );
    return;
  }

  const status = el('p', {});
  const close = (): void => {
    camera?.stop();
    camera = null;
    back();
  };

  camera = await openCamera((event) => {
    if (event.kind === 'AMBIGUOUS') {
      // Several codes in one frame. Never silently mark several assets
      // scanned; make the auditor pick the device actually in their hands.
      rejectScan();
      replace(
        status,
        el('span', {}, 'More than one code in frame — tap the one you are holding:'),
        ...event.values.map((value) =>
          button(value, () => {
            close();
            identifyScanned(value, onTag);
          }),
        ),
      );
      return;
    }
    close();
    identifyScanned(event.value, onTag);
  });

  replace(
    host,
    el('header', {}, el('h1', {}, title), button('Cancel', close)),
    camera.video,
    el('div', { class: 'target' }),
    status,
    camera.hasTorch ? button('Torch', () => void camera?.setTorch(true), 'primary') : '',
  );
}

function identifyScanned(raw: string, onTag: (tag: AssetTag) => void): void {
  const tag = assetTag(raw);
  if (tag === null) {
    rejectScan();
    return;
  }
  void confirmScan();
  onTag(tag);
}

async function finish(): Promise<void> {
  if (state === null) return;
  const finished = result(state);
  const walked = [...finished.confirmed];
  const walk = state.walk;
  const location = state.location;

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
    button('Print QR sheets for this stack', () => offerSheets(walk, location, walked), 'primary wide'),
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
