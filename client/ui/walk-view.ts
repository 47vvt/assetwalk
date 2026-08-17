// The walk screen, and now the only screen of the walk.
//
// Two primitives: tap the device in your hand if it is one of the three on
// screen, or type the tag from its note. Everything the four-step lookup does
// with that tag — restore it from the pile, jump the cursor past a run of
// removals, recognise it from another shelf, record it as new — happens without
// the auditor being told any of it. They are holding a laptop, not reading a
// data model.

import { assetTag, tagShape } from '../core/types.js';
import type { TagShape } from '../core/types.js';
import { lastConfirmed, windowOf } from '../core/walk.js';
import type { Event, State } from '../core/walk.js';
import { button, el, input, replace, tagLabel } from './dom.js';

// After three unrecognised devices in a row the auditor is more likely on the
// wrong shelf than looking at three unknown devices. This is a nudge to
// re-anchor and nothing more: it must never feed the reducer, or the walk
// starts classifying devices by how confused the auditor seems.
const STALL_LIMIT = 3;

// The screen is rebuilt on every event, which destroys the field along with
// everything else. An auditor working through a run of unrecognised devices
// types one tag after another, so the field asks for itself back after a
// submission rather than making them tap it again.
const FIELD_ID = 'tag-entry';
let refocus = false;

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

    // The device just confirmed, faint and out of the way. It is there to be
    // checked at a glance and taken back if it was a mis-tap — a wrong
    // confirmation is otherwise silent, and nothing later in the walk reveals
    // it. Undo rolls back one event, whatever that event was.
    state.previous === null
      ? ''
      : el(
          'section',
          { class: 'last' },
          el(
            'div',
            { class: 'row' },
            el('span', { class: 'caption' }, 'Last confirmed'),
            lastScanned(state),
            button('Undo', () => handlers.dispatch({ kind: 'UNDO' }), 'quiet'),
          ),
        ),

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

    tagEntry(tagShape(walkTags(state)), handlers),

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

  if (refocus) {
    refocus = false;
    window.document.getElementById(FIELD_ID)?.focus();
  }
}

function lastScanned(state: State): HTMLElement {
  const tag = lastConfirmed(state);
  return tag === undefined
    ? el('span', { class: 'empty' }, 'no device confirmed yet')
    : tagLabel(tag);
}

// Everything this walk knows a tag can look like: the shelf as it was, plus
// the assets the audit expects to find anywhere.
function walkTags(state: State): string[] {
  return [...state.roster, ...state.history.map((position) => position.asset)];
}

// One field, no separate screen and no list of what the audit already knows.
// Whether the typed tag is a device from the last walk or one nobody has seen
// before is the reducer's problem, and showing the auditor the shelf's history
// only invites them to answer a question the algorithm exists to avoid asking.
//
// The prefix is a label, not something to type — it is identical on every
// device in the building. What is left is the digits, in one cell each, so the
// auditor can check what they have entered against a handwritten note at a
// glance instead of reading back a run of identical-looking numerals.
function tagEntry(shape: TagShape, handlers: WalkHandlers): HTMLElement {
  const cells = Array.from({ length: shape.digits }, () => el('span', { class: 'cell' }));
  const caret = el('span', { class: 'caret' });

  // One real input behind the cells rather than one input per cell. The
  // browser then handles the caret, backspace, paste, autofill and every
  // mobile keyboard for free, and there is a single value to validate instead
  // of a row of fragments to reassemble.
  const field = input({
    id: FIELD_ID,
    class: 'digits',
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': `Asset tag digits after ${shape.prefix || 'the prefix'}`,
  });

  const track = el('div', { class: 'cells' }, caret, ...cells, field);
  track.style.setProperty('--n', String(shape.digits));

  const show = (): void => {
    const typed = field.value;
    cells.forEach((cell, i) => {
      cell.textContent = typed[i] ?? '';
      cell.classList.toggle('filled', typed[i] !== undefined);
    });
    // The caret is a single element moved with a transform, so it travels
    // between cells rather than blinking from one to the next.
    caret.style.setProperty('--i', String(Math.min(typed.length, shape.digits - 1)));
    caret.classList.toggle('done', typed.length >= shape.digits);
  };

  const send = (): void => {
    const tag = tagOf(shape, field.value);
    if (tag === null) return;
    field.value = '';
    show();
    // The auditor is mid-run and about to type another one.
    refocus = true;
    handlers.dispatch({ kind: 'IDENTIFY', tag });
  };

  field.addEventListener('input', () => {
    // Nothing but digits survives a keystroke: the prefix is already on screen
    // and there are exactly this many places to put a numeral.
    const cleaned = field.value.replace(/[^0-9]/g, '').slice(0, shape.digits);
    if (cleaned !== field.value) field.value = cleaned;
    show();
    // Filling the last cell is the submission. There is no button to press:
    // the row is either complete or it is not, and a numeric keyboard on iOS
    // has no return key to offer instead. A mis-typed tag is taken back with
    // Undo, the same way a mis-tapped entry is.
    if (cleaned.length === shape.digits) send();
  });
  // Hardware keyboards only, and only useful where a site's tags vary in
  // length so that a short one never fills the row.
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') send();
  });
  field.addEventListener('focus', () => track.classList.add('active'));
  field.addEventListener('blur', () => track.classList.remove('active'));

  show();
  return el(
    'section',
    { class: 'identify' },
    el('h2', { class: 'lead' }, 'Not one of these? Type the tag on its note'),
    el(
      'div',
      { class: 'field' },
      shape.prefix === '' ? '' : el('span', { class: 'sitecode' }, shape.prefix),
      track,
    ),
  );
}

function tagOf(shape: TagShape, typed: string): ReturnType<typeof assetTag> {
  return assetTag(shape.prefix + typed);
}
