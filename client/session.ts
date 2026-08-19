// One shelf, being walked right now.
//
// This module holds the only mutable state in the app, and it holds it for as
// short a time as it can. The shelf's recorded order arrives from the backend,
// lives in `state` and nowhere else, and is dropped the moment the auditor's
// confirmations are durable (§5). Nothing here writes to the device.
//
// There is one session at a time by construction — one auditor, one shelf, one
// pair of hands — so it is module state rather than an object that would have
// to be threaded through every handler to say the same thing.

import { assetTag } from './core/types.js';
import type { AssetTag, LocationID, Position, WalkID } from './core/types.js';
import { begin, reduce, result } from './core/walk.js';
import type { Event, ShelfResult, State } from './core/walk.js';
import { pendingCount } from './io/outbox.js';
import { confirmScan, rejectScan } from './platform/haptics.js';
import { openCamera, scanningAvailable } from './platform/scanner.js';
import type { Camera } from './platform/scanner.js';
import { button } from './ui/dom.js';
import { renderNotice } from './ui/notice-view.js';
import { renderScan } from './ui/scan-view.js';
import { renderWalk } from './ui/walk-view.js';

export interface Shelf {
  readonly walk: WalkID;
  readonly location: LocationID;
  readonly history: readonly Position[];
  readonly roster: ReadonlySet<AssetTag>;
}

let host: HTMLElement | null = null;
let state: State | null = null;
// Consecutive unrecognised devices. This is a hint about the auditor and never
// reaches the reducer: how a device is classified must not depend on how
// confused the person holding it seems.
let misses = 0;
// Non-null exactly while the scan screen is up. Scanning is a screen, not an
// overlay: the camera replaces the window, and every event re-renders whichever
// screen the auditor is actually on.
let camera: Camera | null = null;
let ambiguous: readonly string[] = [];
let torch = false;
// Called once, with everything the shelf produced, when the auditor finishes.
let finished: (result: ShelfResult) => void = () => {};

export function startWalk(
  into: HTMLElement,
  shelf: Shelf,
  onFinish: (result: ShelfResult) => void,
): void {
  host = into;
  state = begin(shelf.walk, shelf.location, shelf.history, shelf.roster);
  misses = 0;
  finished = onFinish;
  render();
}

// Leaving a walk without finishing it — the browser's back button, or a route
// the shell decided to take. The camera is a physical device with a light on
// it; nothing else in the app will turn it off.
export function abandonWalk(): void {
  stopCamera();
  state = null;
  host = null;
}

function dispatch(event: Event): void {
  if (state === null) return;
  misses = event.kind === 'IDENTIFY' ? misses + 1 : 0;
  state = reduce(state, event);
  render();
}

function render(): void {
  if (host === null || state === null) return;
  // The same three actions on both screens; only the first one's job differs.
  const handlers = {
    dispatch,
    toggleScan: () => (camera === null ? void openScan() : closeScan()),
    finish,
  };

  if (camera === null) {
    renderWalk(host, state, misses, pendingCount(), handlers);
    return;
  }

  const live = camera;
  renderScan(host, state, live, torch, ambiguous, pendingCount(), {
    ...handlers,
    choose: (value) => {
      ambiguous = [];
      accept(value);
    },
    toggleTorch: () => {
      torch = !torch;
      render();
      void live.setTorch(torch).catch(() => {
        // A device can advertise the torch constraint and still refuse it. Put
        // the label back rather than leaving it claiming a light that is not
        // on.
        torch = false;
        render();
      });
    },
  });
}

// One barcode read locates the cursor in history definitively, which is why
// this is a screen of its own rather than an item in a menu: it is where an
// auditor goes when they have lost their place, and where they stay until they
// have found it again.
async function openScan(): Promise<void> {
  if (host === null) return;
  if (!scanningAvailable()) {
    renderNotice(
      host,
      'Scanning unavailable',
      [
        'This browser has no barcode reader. Type the tag from the note instead — ' +
          'the walk does not need a barcode to finish.',
      ],
      [button('Back', render, 'primary wide')],
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

// A scanned or chosen barcode. Anything that is not an asset tag — a shipping
// label, a rack sticker, a barcode on a box — is rejected with a buzz and no
// screen change, because the auditor is looking at the device rather than the
// phone when it happens.
function accept(raw: string): void {
  const tag = assetTag(raw);
  if (tag === null) {
    rejectScan();
    return;
  }
  void confirmScan();
  dispatch({ kind: 'IDENTIFY', tag });
}

function finish(): void {
  if (state === null) return;
  const shelf = result(state);
  // Finish is reachable from the scan screen too, so the camera is released
  // before the state it belongs to goes away. The history slice is dropped
  // here, before the shell can take a reference to it: the device now holds
  // one shelf's worth of tags rather than the site's.
  abandonWalk();
  finished(shelf);
}
