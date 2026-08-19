// The walk screen. Two primitives: tap the device in your hand if it is one of
// the three on screen, or type the tag from its note.
//
// Everything here is arranged around the fact that the auditor is standing at
// a shelf holding a laptop and looking at a sticky note — not reading an
// interface. The screen has to answer "what do I do with the thing in my
// hand?" without being read.

import { windowOf } from '../core/walk.js';
import type { State } from '../core/walk.js';
import { button, el, tagLabel } from './dom.js';
import { renderWalkScreen } from './walk-frame.js';
import type { Actions } from './walk-frame.js';

// After three unrecognised devices in a row the auditor is more likely on the
// wrong shelf than looking at three unknown devices. This is a nudge to
// re-anchor and nothing more: it must never feed the reducer, or the walk
// starts classifying devices by how confused the auditor seems.
const STALL_LIMIT = 3;

export function renderWalk(
  host: HTMLElement,
  state: State,
  misses: number,
  pending: number,
  handlers: Actions,
): void {
  const upcoming = windowOf(state);

  const windowSection = el(
    'section',
    { class: 'window' },
    el(
      'h2',
      { class: 'lead' },
      upcoming.length > 0 ? 'Tap the device in your hand' : 'End of this shelf',
    ),
    ...upcoming.map((position, offset) =>
      button(
        el('span', { class: 'row' }, tagLabel(position.asset)),
        () => handlers.dispatch({ kind: 'CONFIRM', offset }),
        'entry',
      ),
    ),
    upcoming.length === 0
      ? el(
          'p',
          { class: 'empty' },
          'Nothing left in the recorded order. Anything still on the shelf is ' +
            'either new or has moved — type its tag below.',
        )
      : '',
  );

  const nudge =
    misses < STALL_LIMIT
      ? ''
      : el(
          'p',
          { class: 'nudge' },
          'Three unrecognised devices in a row. Scan a barcode to re-anchor, ' +
            'or check you are on the right shelf.',
        );

  renderWalkScreen(
    host,
    state,
    { notice: nudge, middle: [windowSection], scanning: false, pending },
    handlers,
  );
}
