// The walk screen. Two primitives and nothing else: tap the device in your
// hand if it is on screen, or say it is not.
//
// Everything here is arranged around the fact that the auditor is standing at
// a shelf holding a laptop and looking at a sticky note — not reading an
// interface. The screen has to answer "what do I do with the thing in my
// hand?" without being read.

import { recentOf, windowOf } from '../core/walk.js';
import type { Event, State } from '../core/walk.js';
import type { AssetTag } from '../core/types.js';
import { button, el, replace, tagLabel } from './dom.js';

// After three "not in list" events in a row the auditor is more likely on the
// wrong shelf than looking at three unknown devices. This is a nudge to
// re-anchor and nothing more: it must never feed the reducer, or the walk
// starts classifying devices by how confused the auditor seems.
const STALL_LIMIT = 3;

export interface WalkHandlers {
  readonly dispatch: (event: Event) => void;
  readonly identify: () => void;
  readonly scan: () => void;
  readonly finish: () => void;
}

export function renderWalk(
  host: HTMLElement,
  state: State,
  misses: number,
  pending: number,
  handlers: WalkHandlers,
): void {
  const recent = recentOf(state);
  const upcoming = windowOf(state);
  const ahead = state.history.length - state.cursor;

  replace(
    host,
    el(
      'header',
      {},
      el('h1', {}, state.location),
      el(
        'span',
        { class: 'progress' },
        `${state.confirmed.size} done${ahead > 0 ? ` · ${ahead} ahead` : ''}`,
      ),
      pending > 0 ? el('span', { class: 'pending' }, `${pending} queued`) : '',
    ),

    misses >= STALL_LIMIT
      ? el(
          'p',
          { class: 'nudge' },
          'Three unrecognised devices in a row. Scan one barcode to re-anchor, ' +
            'or check you are on the right shelf.',
        )
      : '',

    // Passed entries stay tappable. An adjacent swap is the most common change
    // between walks, and this turns it into one tap instead of a typed tag —
    // so the heading says what tapping one does, not what the row is.
    recent.length > 0
      ? el(
          'section',
          { class: 'recent' },
          el('h2', {}, 'Already passed — tap to go back'),
          ...recent.map((position, offset) =>
            entry(position.asset, state.cursor - recent.length + offset, state, handlers),
          ),
        )
      : '',

    el(
      'section',
      { class: 'window' },
      el(
        'h2',
        { class: 'lead' },
        upcoming.length > 0 ? 'Tap the device in your hand' : 'End of this shelf',
      ),
      ...upcoming.map((position, offset) =>
        entry(position.asset, state.cursor + offset, state, handlers),
      ),
      upcoming.length === 0
        ? el(
            'p',
            { class: 'empty' },
            'Nothing left in the recorded order. Anything still on the shelf is ' +
              'either new or has moved — use “Not one of these”.',
          )
        : '',
    ),

    el(
      'nav',
      {},
      // The second primitive, and the answer to the commonest question on this
      // screen, so it gets a row of its own.
      button('Not one of these', handlers.identify, 'primary wide'),
      button('Scan a barcode', handlers.scan),
      // A faded sticky note and a missing laptop look identical during a walk
      // and are completely different facts. Recording the difference here is
      // the only moment anyone still knows it.
      button('Can’t read the note', () => handlers.dispatch({ kind: 'UNREADABLE' })),
      // Kept away from Finish: people tapping fast mis-tap, and a wrong
      // confirmation is silent corruption, so undo has to be easy to hit and
      // hard to hit by accident.
      button('Undo last', () => handlers.dispatch({ kind: 'UNDO' }), 'wide quiet'),
      button('Finish shelf', handlers.finish, 'finish wide'),
    ),
  );
}

function entry(
  tag: AssetTag,
  index: number,
  state: State,
  handlers: WalkHandlers,
): HTMLElement {
  const done = state.confirmed.has(tag);
  return button(
    el('span', { class: 'row' }, tagLabel(tag), done ? el('span', { class: 'mark' }, '✓') : ''),
    () => handlers.dispatch({ kind: 'CONFIRM', index }),
    done ? 'entry done' : 'entry',
  );
}
