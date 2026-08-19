// The app shell: work out what has been deployed, sign in if there is anything
// to sign in to, and put the right screen on the URL that asks for it.
//
// Walking a shelf is not here — that is session.ts, which owns the only state
// this app keeps and drops it as soon as it can. What is left is navigation,
// which is deliberately made of URLs: a walk in progress survives a reload, a
// shelf can be linked to, and the back button does what it looks like it does.

import { locationID, walkID } from './core/types.js';
import type { AssetTag, LocationID, WalkID } from './core/types.js';
import type { ShelfResult } from './core/walk.js';
import { parseConfig } from './io/config.js';
import { oauthFrom, signIn } from './io/auth.js';
import { drain, pendingCount, queueSheets, queueShelf } from './io/outbox.js';
import {
  addLocation,
  createWalk,
  fetchHistory,
  fetchLocations,
  fetchRoster,
  fetchWalks,
  removeLocation,
} from './io/server.js';
import type { Backend } from './io/server.js';
import { abandonWalk, startWalk } from './session.js';
import { DEMO_HISTORY, DEMO_LOCATION, DEMO_ROSTER, DEMO_WALK } from './demo-shelf.js';
import { button, el } from './ui/dom.js';
import { renderAudits } from './ui/audits-view.js';
import { renderNewAudit } from './ui/new-audit-view.js';
import { renderNotice } from './ui/notice-view.js';
import { renderSheets } from './ui/sheets-view.js';
import { renderShelves } from './ui/shelves-view.js';

const host = window.document.body;

// Null in standalone demo mode. Everything that would reach the network is
// guarded on it, so opening index.html with no walk in the URL makes no
// requests at all — which is what a reviewer opens and what gets demoed.
let backend: Backend | null = null;
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
  // Three different answers, and they must not be confused. A 404 means
  // nobody has deployed this — it is a checkout opened in a browser, so run
  // the fixture. A network failure with nothing cached means a deployed app
  // that has never been online, and falling back to the fixture there would
  // put an auditor on a demo shelf without telling them.
  const probe = await fetch('./config.json').then(
    (response) => (response.ok ? response.json() : null),
    () => 'unreachable' as const,
  );

  if (probe === 'unreachable') {
    return unreachable(
      'This device has not reached the server since the app was installed, so ' +
        'it does not know which audit to load. Connect once and it will start ' +
        'offline from then on.',
    );
  }

  if (probe === null) {
    const demo = {
      walk: DEMO_WALK,
      location: DEMO_LOCATION,
      history: DEMO_HISTORY,
      roster: DEMO_ROSTER,
    };
    return startWalk(host, demo, complete);
  }
  const config = parseConfig(probe);

  // A standalone SQLite deployment has nothing to sign in to, so it goes
  // straight to the audits. Otherwise sign-in is behind a button, because
  // browsers only open the authorisation window from a user gesture and PKCE
  // needs that window in order to keep the verifier out of storage.
  if (config.oauth === null) {
    backend = { base: config.backend, token: null };
    return route();
  }

  const { instance, clientID } = config.oauth;
  const authorise = () => void signedIn(config.backend, instance, clientID);
  renderNotice(host, 'AssetWalk', [], [button('Sign in', authorise, 'finish wide')]);
}

async function signedIn(base: string, instance: string, clientID: string): Promise<void> {
  const callback = new URL('./callback.html', window.location.href).href;
  backend = { base, token: await signIn(oauthFrom(instance, clientID, callback)) };
  return route();
}

// Which screen the URL is asking for: no walk is the audit list, a walk is its
// shelves, a walk and a location is that shelf being walked.
async function route(): Promise<void> {
  // Any walk that was on screen is not any more, and its camera has to be
  // turned off whether it was finished or navigated away from.
  abandonWalk();

  const params = new URLSearchParams(window.location.search);
  const walk = walkID(params.get('walk') ?? '');
  const location = locationID(params.get('location') ?? '');

  try {
    if (walk === null) return await audits();
    if (location === null) return await shelves(walk);
    return await openShelf(walk, location);
  } catch {
    // A shelf cannot be restored from cache: its positional history is held in
    // memory only and never written to the device (§5), so reopening the app
    // out of signal genuinely cannot resume it. Saying so is the job here —
    // an empty screen would look like the app had crashed.
    return unreachable(
      'Cannot reach the server. A walk already in progress keeps working and ' +
        'its confirmations are queued, but starting one needs the shelf, and ' +
        'the shelf is never stored on the device.',
    );
  }
}

function go(params: string): void {
  window.history.pushState(null, '', params === '' ? window.location.pathname : `?${params}`);
  void route();
}

// The URL is the screen, so the browser's own back button has to move between
// them. Without this it would change the address and leave the page showing
// the screen it was already on.
window.addEventListener('popstate', () => void route());

const auditHandlers = {
  open: (walk: WalkID) => go(`walk=${encodeURIComponent(walk)}`),
  compose: () => renderNewAudit(host, auditHandlers),
  create: (walk: WalkID) => void createAudit(walk),
  cancel: () => void audits(),
};

async function audits(): Promise<void> {
  if (backend === null) return;
  renderAudits(host, await fetchWalks(backend), auditHandlers);
}

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

  // Adding and removing re-fetch rather than patching the list on screen: the
  // backend decides what an audit covers, and a shelf list that disagreed with
  // it would send an auditor to a rack that is no longer in scope.
  const reload = async (edit: Promise<void>): Promise<void> => {
    await edit;
    await shelves(walk);
  };

  renderShelves(host, audit, known, {
    walk: (location) =>
      go(`walk=${encodeURIComponent(walk)}&location=${encodeURIComponent(location)}`),
    add: (id, orientation) => void reload(addLocation(here, walk, { id, orientation })),
    remove: (location) => void reload(removeLocation(here, walk, location)),
    back: () => go(''),
  });
}

async function openShelf(walk: WalkID, location: LocationID): Promise<void> {
  if (backend === null) return;
  const [roster, history] = await Promise.all([
    fetchRoster(backend, walk),
    fetchHistory(backend, location),
  ]);
  const expected = new Set(roster.map((entry) => entry.asset));
  startWalk(host, { walk, location, history, roster: expected }, complete);
}

// The shelf is over and its history is already gone. What is left is the
// confirmations, which are queued rather than sent, because the auditor is
// usually still in the room they had no signal in.
function complete(shelf: ShelfResult): void {
  if (backend !== null) {
    queueShelf(shelf);
    sync();
  }
  showComplete(shelf.walk, shelf.location, shelf.confirmed);
}

function showComplete(walk: WalkID, location: LocationID, walked: readonly AssetTag[]): void {
  renderNotice(
    host,
    `${location} complete`,
    [
      backend === null
        ? `${walked.length} devices confirmed. Standalone demo — nothing was sent anywhere.`
        : `${walked.length} devices confirmed and queued.`,
      // What could not be accounted for is deliberately not shown and not
      // asked about. Whether a tag is a removal depends on every other shelf
      // in the audit, which this device does not have and is not going to be
      // given — the variance report is produced once the whole walk is in.
      el(
        'p',
        { class: 'empty' },
        'Anything unaccounted for is settled audit-wide, after every shelf is in.',
      ),
    ],
    [
      // A horizontal stack is walked with the same reducer; all that differs is
      // what happens at the end, because Algorithm 2's mechanism is the paper.
      button('Print QR sheets for this stack', () => sheets(walk, location, walked), 'primary wide'),
      // The fixture has no audit behind it and so nowhere to go back to.
      backend === null
        ? ''
        : button('Back to shelves', () => go(`walk=${encodeURIComponent(walk)}`), 'finish wide'),
    ],
  );
}

function sheets(walk: WalkID, location: LocationID, walked: readonly AssetTag[]): void {
  renderSheets(host, walk, location, walked, (sheets) => {
    if (backend !== null) {
      queueSheets(location, sheets);
      sync();
    }
    showComplete(walk, location, walked);
  });
}

function unreachable(why: string): void {
  renderNotice(
    host,
    'No connection',
    [
      why,
      pendingCount() === 0
        ? ''
        : el(
            'p',
            { class: 'empty' },
            `${pendingCount()} shelves are queued and will send when it returns.`,
          ),
    ],
    [button('Try again', () => void route(), 'finish wide')],
  );
}

// Registered after the first render, so a failure to install the offline
// shell never stops the app starting. Absent in the fixture path too — a
// checkout opened from a file:// URL has no worker scope.
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {
      // An audit does not need the offline shell to run today; it needs the
      // walk to start. Nothing here is worth interrupting that for.
    });
  });
}

void load();
