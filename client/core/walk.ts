// Algorithm 1 — walking a vertical shelf by sticky note alone.
//
// The auditor reads handwritten notes protruding from a row of laptops and
// never pulls a device out. The order is mostly, but not exactly, what it was
// last walk. Two primitives are enough to cover every mutation:
//
//   tap a window entry   → confirm it; anything stepped over falls to the pile
//   type the tag         → identify the device, then a four-step lookup
//
// The invariant that collapses every earlier heuristic: a window miss is not a
// decision point. A brand-new device and a device sitting further down history
// behind a run of removals are indistinguishable at the moment of the miss, so
// the auditor is never asked to distinguish them. Identification classifies.

import type { AssetTag, LocationID, Position, WalkID } from './types.js';

// Three entries is what an auditor can hold in view and check against the note
// in front of them in one glance, without scanning a list or losing their
// place on the shelf.
export const WINDOW = 3;

export type Event =
  // `offset` is into the window, not into history. That is what makes
  // confirming an entry the auditor has already walked past unrepresentable,
  // rather than something the reducer has to guard against at runtime.
  | { kind: 'CONFIRM'; offset: number }
  | { kind: 'IDENTIFY'; tag: AssetTag }
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
  // The state before the last event. Undo is a pointer rather than a set of
  // inverse operations: states are immutable and structurally shared, a shelf
  // is ~40 entries, and keeping the chain costs less than reasoning about how
  // to un-sweep a pile would. One tap is one event.
  readonly previous: State | null;
}

export interface ShelfResult {
  readonly walk: WalkID;
  readonly location: LocationID;
  readonly confirmed: readonly AssetTag[];
  readonly unresolved: readonly AssetTag[];
  readonly newDevices: readonly AssetTag[];
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
    previous: null,
  };
}

// The device most recently confirmed. Derived rather than stored: the
// confirmation map is already in the order the auditor met the devices, so its
// last key is the answer and a second copy could only disagree with it.
export function lastConfirmed(state: State): AssetTag | undefined {
  return [...state.confirmed.keys()].at(-1);
}

// The next WINDOW entries at or after the cursor. No entry at or after the
// cursor has been confirmed — confirming one always moves the cursor past it —
// so "the next unconfirmed entries" and "the next entries" are the same set.
export function windowOf(state: State): readonly Position[] {
  return state.history.slice(state.cursor, state.cursor + WINDOW);
}

export function reduce(state: State, event: Event): State {
  switch (event.kind) {
    case 'CONFIRM':
      return confirmAhead(state, event.offset);

    case 'IDENTIFY':
      return identify(state, event.tag);

    case 'UNDO':
      return state.previous ?? state;

    default: {
      const _never: never = event;
      return _never;
    }
  }
}

function confirmAhead(state: State, offset: number): State {
  const index = state.cursor + offset;
  const position = state.history[index];
  // noUncheckedIndexedAccess makes the bound explicit, and the same check
  // covers a negative offset. The UI only ever emits an offset it rendered, so
  // this is unreachable in the app; it is here because the type says it must be.
  if (position === undefined) return state;

  // Everything between the cursor and the tapped entry was stepped over. It is
  // unresolved, not removed: that call is made audit-wide at the end of the
  // walk, because a tag unresolved on this shelf is often confirmed on
  // another. Sweeping the whole run in one move is what makes a run of
  // removals cost one interaction instead of one per device.
  const pile = new Map(state.pile);
  for (const skipped of state.history.slice(state.cursor, index)) {
    pile.set(skipped.asset, skipped);
  }
  return confirmed(state, position.asset, pile, index + 1);
}

// The four-step lookup. Order matters: resolving a step 1 as a step 4 invents a
// phantom removal *and* a phantom new device out of a single entry.
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
  if (found !== -1) return confirmAhead(state, found - state.cursor);

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
  };
}
