// The walk screen, and now the only screen of the walk.
//
// Two primitives: tap the device in your hand if it is one of the three on
// screen, or type the tag from its note. Everything the four-step lookup does
// with that tag — restore it from the pile, jump the cursor past a run of
// removals, recognise it from another shelf, record it as new — happens without
// the auditor being told any of it. They are holding a laptop, not reading a
// data model.

import { assetTag } from '../core/types.js';
import { windowOf } from '../core/walk.js';
import type { Event, State } from '../core/walk.js';
import { button, el, input, replace, tagLabel } from './dom.js';

// After three unrecognised devices in a row the auditor is more likely on the
// wrong shelf than looking at three unknown devices. This is a nudge to
// re-anchor and nothing more: it must never feed the reducer, or the walk
// starts classifying devices by how confused the auditor seems.
const STALL_LIMIT = 3;

// Four letters of site prefix plus ten digits is the widest tag the domain
// allows, so nothing longer can be a typo worth keeping.
const MAX_TAG = 14;

export interface WalkHandlers {
  readonly dispatch: (event: Event) => void;
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

    el(
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
    ),

    tagEntry(handlers),

    el(
      'nav',
      {},
      button('Scan a barcode', handlers.scan),
      // A faded sticky note and a missing laptop look identical during a walk
      // and are completely different facts. Recording the difference here is
      // the only moment anyone still knows it.
      button('Can’t read the note', () => handlers.dispatch({ kind: 'UNREADABLE' })),
      button('Finish shelf', handlers.finish, 'finish wide'),
    ),
  );
}

// One field, no separate screen and no list of what the audit already knows.
// Whether the typed tag is a device from the last walk or one nobody has seen
// before is the reducer's problem, and showing the auditor the shelf's history
// only invites them to answer a question the algorithm exists to avoid asking.
function tagEntry(handlers: WalkHandlers): HTMLElement {
  const field = input({
    class: 'tagfield',
    type: 'text',
    inputmode: 'text',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    placeholder: 'UOM000000',
    'aria-label': 'Asset tag from the note',
  });
  const submit = button('Enter', () => send(), 'primary');

  const send = (): void => {
    const tag = assetTag(field.value);
    if (tag === null) return;
    field.value = '';
    submit.setAttribute('disabled', '');
    handlers.dispatch({ kind: 'IDENTIFY', tag });
  };

  field.addEventListener('input', () => {
    // Nothing that cannot appear in an asset tag is allowed to survive a
    // keystroke, so the field can only ever hold a prefix of a real tag.
    const cleaned = field.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MAX_TAG);
    if (cleaned !== field.value) field.value = cleaned;
    submit.toggleAttribute('disabled', assetTag(cleaned) === null);
  });

  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') send();
  });

  submit.setAttribute('disabled', '');
  return el(
    'section',
    { class: 'identify' },
    el('h2', { class: 'lead' }, 'Not one of these? Type the tag on its note'),
    el('div', { class: 'field' }, field, submit),
  );
}
