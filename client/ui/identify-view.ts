// "Not in list": naming the device in hand.
//
// Order of offers matters. The remaining shelf history comes first because the
// commonest reason a device is not in the window is that a run of devices
// above it went away — and picking it there costs one tap. Only then the wider
// roster, and only then a typed tag.

import { assetTag, digitsOf } from '../core/types.js';
import type { AssetTag } from '../core/types.js';
import type { State } from '../core/walk.js';
import { button, el, replace, tagLabel } from './dom.js';

export interface IdentifyHandlers {
  readonly choose: (tag: AssetTag) => void;
  readonly cancel: () => void;
}

// Two or three digits collapse a forty-device roster to a handful, and the
// match runs against digits from anywhere in the tag: handwritten labels lose
// leading characters to wear, so a note reading "0313" has to find UOM270313.
const SHOW_LIMIT = 12;

export function renderIdentify(
  host: HTMLElement,
  state: State,
  handlers: IdentifyHandlers,
): void {
  let typed = '';

  const results = el('section', { class: 'results' });
  const readout = el('output', { class: 'readout' });
  const hint = el('p', { class: 'hint' });

  const refresh = (): void => {
    readout.textContent = typed;
    hint.textContent =
      typed === ''
        ? 'Tap digits from the note to narrow the list'
        : 'Showing every tag containing';

    const ahead = state.history
      .slice(state.cursor)
      .map((position) => position.asset)
      .filter((tag) => matches(tag, typed));

    // Everything on the roster that is not already accounted for on this
    // shelf: assets relocated from elsewhere in the audit turn up here.
    const onThisShelf = new Set(ahead);
    const elsewhere = [...state.roster]
      .filter((tag) => matches(tag, typed) && !onThisShelf.has(tag) && !state.confirmed.has(tag))
      .slice(0, SHOW_LIMIT);

    replace(
      results,
      group('Still expected on this shelf', ahead.slice(0, SHOW_LIMIT), handlers),
      group('Somewhere else in this audit', elsewhere, handlers),
      // Offered only once nothing else matches, so the auditor cannot record a
      // phantom new device while the real entry is sitting on screen above it.
      newDevice(typed, ahead.length + elsewhere.length === 0, handlers),
    );
  };

  const press = (digit: string): void => {
    typed += digit;
    refresh();
  };

  replace(
    host,
    el(
      'header',
      {},
      el('h1', {}, 'Which device is it?'),
      button('Back', handlers.cancel),
    ),
    // The full remaining shelf comes first and typing only narrows it. The
    // commonest reason a device is missing from the window is a run of
    // removals above it, and that device is already on this list — reaching
    // for the keypad should never be the first move.
    results,
    el(
      'div',
      { class: 'pad' },
      hint,
      readout,
      el(
        'div',
        { class: 'keypad' },
        ...'123456789'.split('').map((d) => button(d, () => press(d))),
        button('⌫', () => {
          typed = typed.slice(0, -1);
          refresh();
        }),
        button('0', () => press('0')),
        button('clear', () => {
          typed = '';
          refresh();
        }),
      ),
    ),
  );
  refresh();
}

function group(title: string, tags: readonly AssetTag[], handlers: IdentifyHandlers): HTMLElement {
  return el(
    'div',
    { class: 'group' },
    el('h2', {}, title),
    ...(tags.length === 0
      ? [el('p', { class: 'empty' }, 'nothing matching')]
      : tags.map((tag) =>
          button(el('span', { class: 'row' }, tagLabel(tag)), () => handlers.choose(tag), 'entry'),
        )),
  );
}

function matches(tag: AssetTag, typed: string): boolean {
  return typed === '' || digitsOf(tag).includes(typed);
}

// A tag that matches nothing is still a real device in the auditor's hands.
// The reducer decides what it means; the UI only has to get the digits across.
function newDevice(typed: string, offer: boolean, handlers: IdentifyHandlers): HTMLElement | string {
  const tag = assetTag(typed);
  if (!offer || tag === null) return '';
  return el(
    'div',
    { class: 'group' },
    el('h2', {}, 'Not expected anywhere in this audit'),
    button(
      el(
        'span',
        { class: 'row' },
        tagLabel(tag),
        el('small', {}, 'record as a device nobody expected'),
      ),
      () => handlers.choose(tag),
      'entry',
    ),
  );
}
