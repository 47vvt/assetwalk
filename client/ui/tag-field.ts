// Typing the tag off a device's sticky note.
//
// One field, and no list of what the audit already knows. Whether the typed
// tag belongs to a device from the last walk or to one nobody has seen before
// is the reducer's problem, and showing the auditor the shelf's history only
// invites them to answer a question the algorithm exists to avoid asking.

import { assetTag, tagShape } from '../core/types.js';
import type { State } from '../core/walk.js';
import type { Event } from '../core/walk.js';
import { el, input } from './dom.js';

// Every screen is rebuilt on every event, which destroys the field along with
// everything else. An auditor working through a run of unrecognised devices
// types one tag after another, so the field asks for itself back after a
// submission rather than making them tap it again.
const FIELD_ID = 'tag-entry';
let refocus = false;

// Called by whoever rebuilt the screen, once the new field is in the document.
export function restoreFocus(): void {
  if (!refocus) return;
  refocus = false;
  window.document.getElementById(FIELD_ID)?.focus();
}

// The prefix is a label rather than something to type — it is identical on
// every device in the building. What is left is the digits, in one cell each,
// so the auditor can check what they entered against a handwritten note at a
// glance instead of reading back a run of identical-looking numerals.
export function tagField(state: State, dispatch: (event: Event) => void): HTMLElement {
  const shape = tagShape([...state.roster, ...state.history.map((position) => position.asset)]);
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
    const tag = assetTag(shape.prefix + field.value);
    if (tag === null) return;
    field.value = '';
    show();
    refocus = true;
    dispatch({ kind: 'IDENTIFY', tag });
  };

  field.addEventListener('input', () => {
    // Nothing but digits survives a keystroke: the prefix is already on screen
    // and there are exactly this many places to put a numeral.
    const cleaned = field.value.replace(/[^0-9]/g, '').slice(0, shape.digits);
    if (cleaned !== field.value) field.value = cleaned;
    show();
    // Filling the last cell is the submission. There is no button to press:
    // the row is either complete or it is not, and a numeric keyboard on iOS
    // has no return key to offer instead. A mis-keyed tag is taken back with
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
