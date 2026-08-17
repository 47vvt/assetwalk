// The walk screen. Two primitives and nothing else: tap an entry to confirm
// it, or say it is not in the list.

import { recentOf, windowOf } from '../core/walk.js';
import type { Event, State } from '../core/walk.js';
import type { AssetTag } from '../core/types.js';
import { button, el, lastFour, replace } from './dom.js';

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

  replace(
    host,
    el(
      'header',
      {},
      el('h1', {}, state.location),
      el('span', { class: 'progress' }, `${state.confirmed.size} confirmed`),
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
    // between walks, and this turns it into one tap instead of a typed tag.
    recent.length > 0
      ? el(
          'section',
          { class: 'recent' },
          el('h2', {}, `last ${recent.length} passed`),
          ...recent.map((position, offset) =>
            entry(position.asset, state.cursor - recent.length + offset, state, handlers),
          ),
        )
      : '',

    el(
      'section',
      { class: 'window' },
      ...upcoming.map((position, offset) =>
        entry(position.asset, state.cursor + offset, state, handlers),
      ),
      upcoming.length === 0
        ? el('p', { class: 'empty' }, 'End of this shelf’s history.')
        : '',
    ),

    el(
      'nav',
      {},
      button('Not in list', handlers.identify, 'primary'),
      button('Scan to re-anchor', handlers.scan, 'primary'),
      // A faded sticky note and a missing laptop look identical during a walk
      // and are completely different facts. Recording the difference here is
      // the only moment anyone still knows it.
      button('Can’t read note', () => handlers.dispatch({ kind: 'UNREADABLE' })),
      button('Undo', () => handlers.dispatch({ kind: 'UNDO' })),
      button('Finish shelf', handlers.finish, 'finish'),
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
    el(
      'span',
      {},
      el('strong', {}, lastFour(tag)),
      el('small', {}, tag),
    ),
    () => handlers.dispatch({ kind: 'CONFIRM', index }),
    done ? 'entry done' : 'entry',
  );
}
