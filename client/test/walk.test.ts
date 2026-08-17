// Silent audit corruption is undetectable in production: a wrong record looks
// exactly like a right one. So the reducer is tested by fuzzing rather than by
// example — generate a shelf, mutate it the ways a real shelf mutates, walk it
// with a simulated auditor, and assert the reconstruction matches the mutation
// that was actually applied.

import assert from 'node:assert/strict';
import test from 'node:test';

import { assetTag, locationID, walkID } from '../core/types.js';
import type { AssetTag, LocationID, Position, WalkID } from '../core/types.js';
import { RECENT, begin, recentOf, reduce, result, windowOf } from '../core/walk.js';
import type { ShelfResult, State } from '../core/walk.js';

function must<T extends string>(value: T | null): T {
  if (value === null) throw new Error('test fixture is malformed');
  return value;
}

const WALK: WalkID = must(walkID('test-walk'));
const BAY: LocationID = must(locationID('BAY-A3'));

function tag(digits: number): AssetTag {
  return must(assetTag(`UOM${String(digits).padStart(6, '0')}`));
}

function shelfOf(tags: readonly AssetTag[]): Position[] {
  return tags.map((asset, sequence) => ({ location: BAY, sequence, asset }));
}

// A perfect auditor: sees the devices in their real physical order, taps
// whatever is on screen, and types a tag only when nothing on screen matches.
// Counts its own interactions so tests can assert on effort, not just outcome.
function walkShelf(
  history: readonly Position[],
  roster: ReadonlySet<AssetTag>,
  shelf: readonly AssetTag[],
): { readonly outcome: ShelfResult; readonly typed: number } {
  let state: State = begin(WALK, BAY, history, roster);
  let typed = 0;

  for (const asset of shelf) {
    const ahead = windowOf(state).findIndex((position) => position.asset === asset);
    if (ahead !== -1) {
      state = reduce(state, { kind: 'CONFIRM', index: state.cursor + ahead });
      continue;
    }
    const passed = recentOf(state);
    const behind = passed.findIndex((position) => position.asset === asset);
    if (behind !== -1) {
      state = reduce(state, { kind: 'CONFIRM', index: state.cursor - passed.length + behind });
      continue;
    }
    typed += 1;
    state = reduce(state, { kind: 'IDENTIFY', tag: asset });
  }
  return { outcome: result(state), typed };
}

test('reproduces the reference implementation on its own example', () => {
  const history = shelfOf([123456, 270313, 420696, 400699, 220126, 724528].map(tag));
  const shelf = [270313, 123456, 400699, 696969, 220126, 724528].map(tag);
  const roster = new Set(history.map((position) => position.asset));

  const { outcome } = walkShelf(history, roster, shelf);

  assert.deepEqual([...outcome.unresolved], [tag(420696)]);
  assert.deepEqual([...outcome.newDevices], [tag(696969)]);
  // The reference prints "expected: 5", meaning five of the six devices it was
  // looking for were found. Six devices were confirmed in total; the sixth was
  // not one it was looking for.
  assert.equal(outcome.confirmed.length, 6);
  assert.equal(outcome.confirmed.length - outcome.newDevices.length, 6 - 1);
});

test('a run of removals costs one interaction, not one per device', () => {
  const history = shelfOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(tag));
  const roster = new Set(history.map((position) => position.asset));
  // Six consecutive devices gone — far past the four-entry window, which is
  // the case that made every earlier design ask the auditor a question.
  const shelf = [tag(1), tag(8), tag(9), tag(10)];

  const { outcome, typed } = walkShelf(history, roster, shelf);

  assert.equal(typed, 1);
  assert.deepEqual([...outcome.confirmed], shelf);
  assert.deepEqual([...outcome.unresolved].sort(), [2, 3, 4, 5, 6, 7].map(tag).sort());
  assert.deepEqual([...outcome.newDevices], []);
});

test('an adjacent swap is resolved by tapping, without typing a tag', () => {
  const history = shelfOf([1, 2, 3, 4].map(tag));
  const roster = new Set(history.map((position) => position.asset));

  const { outcome, typed } = walkShelf(history, roster, [tag(2), tag(1), tag(3), tag(4)]);

  assert.equal(typed, 0);
  assert.deepEqual([...outcome.confirmed], [tag(2), tag(1), tag(3), tag(4)]);
  assert.deepEqual([...outcome.unresolved], []);
});

test('a device moved beyond the recent strip still resolves from the pile', () => {
  const history = shelfOf([1, 2, 3, 4, 5, 6, 7, 8].map(tag));
  const roster = new Set(history.map((position) => position.asset));
  // Device 1 has moved to the bottom, well past the RECENT entries kept on
  // screen, so the auditor has to name it. Step 1 of the lookup finds it.
  const shelf = [2, 3, 4, 5, 6, 7, 8, 1].map(tag);

  const { outcome, typed } = walkShelf(history, roster, shelf);

  assert.ok(RECENT < 7);
  assert.equal(typed, 1);
  assert.deepEqual([...outcome.confirmed], shelf);
  assert.deepEqual([...outcome.unresolved], []);
});

test('an asset from another shelf is confirmed, not recorded as new', () => {
  const history = shelfOf([1, 2, 3].map(tag));
  const roster = new Set([...history.map((position) => position.asset), tag(99)]);

  const { outcome } = walkShelf(history, roster, [tag(1), tag(99), tag(2), tag(3)]);

  assert.deepEqual([...outcome.newDevices], []);
  assert.ok(outcome.confirmed.includes(tag(99)));
  assert.deepEqual([...outcome.unresolved], []);
});

test('undo restores the state before the last event', () => {
  const history = shelfOf([1, 2, 3, 4, 5, 6].map(tag));
  const roster = new Set(history.map((position) => position.asset));
  let state = begin(WALK, BAY, history, roster);

  // Confirm the fifth entry: four entries sweep into the pile in one move.
  state = reduce(state, { kind: 'CONFIRM', index: 4 });
  assert.equal(state.pile.size, 4);

  state = reduce(state, { kind: 'UNDO' });
  assert.equal(state.pile.size, 0);
  assert.equal(state.cursor, 0);
  assert.equal(state.confirmed.size, 0);
});

test('undo at the start of a walk is a no-op', () => {
  const state = begin(WALK, BAY, shelfOf([1, 2].map(tag)), new Set());
  assert.equal(reduce(state, { kind: 'UNDO' }), state);
});

test('unreadable devices are counted without inventing a tag', () => {
  const history = shelfOf([1, 2, 3].map(tag));
  let state = begin(WALK, BAY, history, new Set());

  state = reduce(state, { kind: 'UNREADABLE' });
  state = reduce(state, { kind: 'UNREADABLE' });

  assert.equal(state.unreadable, 2);
  assert.equal(state.cursor, 0);
  assert.equal(state.pile.size, 0);
  assert.equal(result(state).unreadable, 2);
});

test('nothing is ever marked removed during a walk', () => {
  const history = shelfOf([1, 2, 3, 4, 5].map(tag));
  const roster = new Set(history.map((position) => position.asset));
  const { outcome } = walkShelf(history, roster, [tag(5)]);

  // Four devices were stepped over and nothing else was found. All four are
  // unresolved; none of them is a removal, because that decision belongs to
  // the audit-wide pass, not to this shelf.
  assert.deepEqual([...outcome.unresolved].sort(), [1, 2, 3, 4].map(tag).sort());
  assert.deepEqual([...outcome.newDevices], []);
});

/* ---- Property tests -------------------------------------------------- */

// Deterministic so a failure can be replayed from the seed printed with it.
function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 1_000_000) / 1_000_000;
  };
}

interface Mutation {
  readonly shelf: AssetTag[];
  readonly relocated: AssetTag[];
  readonly brandNew: AssetTag[];
}

function mutate(random: () => number, history: readonly AssetTag[]): Mutation {
  const shelf = [...history];
  const relocated: AssetTag[] = [];
  const brandNew: AssetTag[] = [];
  let minted = 500_000;

  const operations = 1 + Math.floor(random() * 6);
  for (let i = 0; i < operations; i++) {
    const at = Math.floor(random() * Math.max(1, shelf.length));
    switch (Math.floor(random() * 5)) {
      case 0: {
        // A run of devices taken away — the case the window cannot see past.
        shelf.splice(at, 1 + Math.floor(random() * 4));
        break;
      }
      case 1: {
        const swap = shelf[at];
        const next = shelf[at + 1];
        if (swap !== undefined && next !== undefined) {
          shelf[at] = next;
          shelf[at + 1] = swap;
        }
        break;
      }
      case 2: {
        const [moved] = shelf.splice(at, 1);
        if (moved !== undefined) shelf.splice(Math.floor(random() * (shelf.length + 1)), 0, moved);
        break;
      }
      case 3: {
        const fresh = tag((minted += 1));
        brandNew.push(fresh);
        shelf.splice(at, 0, fresh);
        break;
      }
      default: {
        const arrival = tag((minted += 1));
        relocated.push(arrival);
        shelf.splice(at, 0, arrival);
        break;
      }
    }
  }
  return { shelf, relocated, brandNew };
}

test('a perfect auditor reconstructs exactly the mutation that was applied', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const random = rng(seed);
    const history = Array.from({ length: 5 + Math.floor(random() * 40) }, (_, i) => tag(i + 1));
    const { shelf, relocated, brandNew } = mutate(random, history);
    const roster = new Set([...history, ...relocated]);

    const { outcome } = walkShelf(shelfOf(history), roster, shelf);
    const context = `seed ${seed}`;

    // The new shelf order is exactly what the auditor walked past.
    assert.deepEqual([...outcome.confirmed], shelf, context);

    // Unresolved is precisely what was on the shelf before and is not now.
    // Not "removed" — unresolved. Every removal candidate is in here, and so
    // is every device that moved to another bay.
    const gone = history.filter((asset) => !shelf.includes(asset));
    assert.deepEqual([...outcome.unresolved].sort(), [...gone].sort(), context);

    // A device that was never on any roster is the only thing called new.
    // Anything relocated from another shelf resolves at step 3 and is not.
    assert.deepEqual(
      [...outcome.newDevices].sort(),
      brandNew.filter((asset) => shelf.includes(asset)).sort(),
      context,
    );
  }
});

test('undo unwinds any walk back to its starting state', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const random = rng(seed);
    const history = Array.from({ length: 5 + Math.floor(random() * 20) }, (_, i) => tag(i + 1));
    const { shelf } = mutate(random, history);
    const roster = new Set(history);
    const start = begin(WALK, BAY, shelfOf(history), roster);

    let state = start;
    let events = 0;
    for (const asset of shelf) {
      const ahead = windowOf(state).findIndex((position) => position.asset === asset);
      state =
        ahead !== -1
          ? reduce(state, { kind: 'CONFIRM', index: state.cursor + ahead })
          : reduce(state, { kind: 'IDENTIFY', tag: asset });
      events += 1;
    }
    for (let i = 0; i < events; i++) state = reduce(state, { kind: 'UNDO' });

    assert.equal(state.cursor, 0, `seed ${seed}`);
    assert.equal(state.pile.size, 0, `seed ${seed}`);
    assert.equal(state.confirmed.size, 0, `seed ${seed}`);
    assert.deepEqual(state.newDevices, [], `seed ${seed}`);
  }
});
