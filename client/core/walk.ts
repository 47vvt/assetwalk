// Algorithm 1 — walking a vertical shelf by sticky note alone.
//
// The auditor reads handwritten notes protruding from a row of laptops and
// never pulls a device out. The order is mostly, but not exactly, what it was
// last walk. Two primitives are enough to cover every mutation:
//
//   tap a window entry   → confirm it; anything stepped over falls to the pile
//   "not in list"        → identify the device, then a four-step lookup
//
// The invariant that collapses every earlier heuristic: a window miss is not a
// decision point. A brand-new device and a device sitting further down history
// behind a run of removals are indistinguishable at the moment of the miss, so
// the auditor is never asked to distinguish them. Identification classifies.

import type { AssetTag, LocationID, Position, WalkID } from './types.js';

// Four entries is what an auditor can hold in view and compare against the
// notes in front of them without losing their place on the shelf.
export const WINDOW = 4;

// Two already-passed entries stay on screen above the cursor. An adjacent swap
// is the most common mutation between walks, and showing the entry just
// stepped over resolves it with a tap instead of a typed tag.
export const RECENT = 2;

export type Event =
  | { kind: 'CONFIRM'; index: number }
  | { kind: 'IDENTIFY'; tag: AssetTag }
  | { kind: 'UNREADABLE' }
  | { kind: 'UNDO' };

export interface State {
  readonly walk: WalkID;
  readonly location: LocationID;
  readonly history: readonly Position[];
  // Everything below the cursor is confirmed or in the pile; everything at or
  // above it is untouched. That is why the window is a plain slice.
  readonly cursor: number;
  readonly roster: ReadonlySet<AssetTag>;
  readonly pile: ReadonlyMap<AssetTag, Position>;
  // Insertion order is the order the auditor met the devices, which is the
  // shelf's new physical order. That makes this the next walk's history.
  readonly confirmed: ReadonlyMap<AssetTag, number>;
  readonly newDevices: readonly AssetTag[];
  // Devices seen whose note could not be read. A count, not a set: at the
  // moment of the event nobody knows which entry it was, and guessing would
  // put a fabricated tag into the record. Reconciliation uses it to say "N of
  // these unresolved tags are physically present" (§9).
  readonly unreadable: number;
  // Undo is a pointer to the state before the last event. States are immutable
  // and structurally shared, and a shelf is ~40 entries, so keeping the whole
  // chain costs less than reasoning about inverse operations would.
  readonly previous: State | null;
}

export interface ShelfResult {
  readonly walk: WalkID;
  readonly location: LocationID;
  readonly confirmed: readonly AssetTag[];
  readonly unresolved: readonly AssetTag[];
  readonly newDevices: readonly AssetTag[];
  readonly unreadable: number;
}

export function begin(
  walk: WalkID,
  location: LocationID,
  history: readonly Position[],
  roster: ReadonlySet<AssetTag>,
): State {
  return {
    walk,
    location,
    history,
    cursor: 0,
    roster,
    pile: new Map(),
    confirmed: new Map(),
    newDevices: [],
    unreadable: 0,
    previous: null,
  };
}

// The next WINDOW entries at or after the cursor. No entry at or after the
// cursor has been confirmed — confirming one always moves the cursor past it —
// so "the next unconfirmed entries" and "the next entries" are the same set.
export function windowOf(state: State): readonly Position[] {
  return state.history.slice(state.cursor, state.cursor + WINDOW);
}

// Entries the auditor has already stepped over, nearest first. Tapping one is
// an ordinary CONFIRM: below the cursor an unconfirmed entry is in the pile,
// and restoring it from the pile is the same act as confirming it.
export function recentOf(state: State): readonly Position[] {
  return state.history.slice(Math.max(0, state.cursor - RECENT), state.cursor);
}

export function reduce(state: State, event: Event): State {
  switch (event.kind) {
    case 'CONFIRM':
      return confirmAt(state, event.index);

    case 'IDENTIFY':
      return identify(state, event.tag);

    case 'UNREADABLE':
      return { ...state, unreadable: state.unreadable + 1, previous: state };

    case 'UNDO':
      return state.previous ?? state;

    default: {
      const _never: never = event;
      return _never;
    }
  }
}

// `index` is an index into `history`, not into the window — the window is
// derived, and the UI maps a tap back to the entry it rendered.
function confirmAt(state: State, index: number): State {
  const position = state.history[index];
  // noUncheckedIndexedAccess makes the bound explicit. The UI only ever emits
  // an index it has rendered, so this is unreachable in the app; it is here
  // because the type of `history[index]` says it must be.
  if (position === undefined) return state;

  const pile = new Map(state.pile);

  if (index < state.cursor) {
    // Already stepped over: an adjacent swap, or a device moved within this
    // shelf. Take it back out of the pile. The cursor does not move — the
    // auditor is still working forward from where they were.
    pile.delete(position.asset);
    return confirmed(state, position.asset, pile, state.cursor);
  }

  // Everything between the cursor and the tapped entry was stepped over. It is
  // unresolved, not removed: that call is made audit-wide at the end of the
  // walk, because a tag unresolved on this shelf is often confirmed on
  // another. Sweeping the whole run in one move is what makes a run of
  // removals cost one interaction instead of one per device.
  for (const skipped of state.history.slice(state.cursor, index)) {
    pile.set(skipped.asset, skipped);
  }
  return confirmed(state, position.asset, pile, index + 1);
}

// The four-step lookup. Order matters: resolving step 1 as step 4 invents a
// phantom removal *and* a phantom new device out of a single tap.
function identify(state: State, tag: AssetTag): State {
  // 1. In the pile → the device moved within this shelf. Restore and confirm.
  if (state.pile.has(tag)) {
    const pile = new Map(state.pile);
    pile.delete(tag);
    return confirmed(state, tag, pile, state.cursor);
  }

  // 2. Further down this shelf's history → the entries in between were stepped
  //    over. Search the whole remaining tail, not just the window: a long run
  //    of removals is exactly what puts the device out of window range.
  const found = state.history.findIndex(
    (position, i) => i >= state.cursor && position.asset === tag,
  );
  if (found !== -1) return confirmAt(state, found);

  // 3. On the audit roster → a real asset relocated from another shelf. It is
  //    recorded as an ordinary confirmation: "found" is the whole fact, and
  //    cross-shelf reconciliation reads it back out of the confirmations.
  const pile = new Map(state.pile);
  if (state.roster.has(tag)) return confirmed(state, tag, pile, state.cursor);

  // 4. Nowhere → genuinely new. The cursor does not move and nothing is
  //    flushed: a device that was never here says nothing about its neighbours.
  const next = confirmed(state, tag, pile, state.cursor);
  return { ...next, newDevices: [...state.newDevices, tag] };
}

function confirmed(
  state: State,
  tag: AssetTag,
  pile: Map<AssetTag, Position>,
  cursor: number,
): State {
  const map = new Map(state.confirmed);
  // Re-confirming is a no-op rather than a reordering: an auditor who types a
  // tag they already scanned should not shuffle the new shelf order.
  if (!map.has(tag)) map.set(tag, map.size);
  return { ...state, pile, cursor, confirmed: map, previous: state };
}

// Sent to the server on shelf completion, immediately before the history slice
// is discarded from memory (§5).
export function result(state: State): ShelfResult {
  return {
    walk: state.walk,
    location: state.location,
    confirmed: [...state.confirmed.keys()],
    // The pile plus the tail the walk never reached. Nothing here is a
    // removal — it is unresolved, and stays that way until the server has
    // looked at every shelf.
    unresolved: [
      ...state.pile.keys(),
      ...state.history.slice(state.cursor).map((position) => position.asset),
    ],
    newDevices: state.newDevices,
    unreadable: state.unreadable,
  };
}
