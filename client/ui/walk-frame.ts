// The shape every screen of a walk has, whether or not the camera is on.
//
// Scanning is a mode of the walk, not a different job, so both screens are one
// screen with a different middle: the shelf and progress at the top, the
// device just confirmed under it, the middle, then the field for naming a
// device that is not on screen and the same three actions. Only the middle
// changes, and having it here is what makes that true rather than merely
// intended. Two copies would drift, and then the walk would record different
// things depending on which screen the auditor happened to be looking at.

import { lastConfirmed } from '../core/walk.js';
import type { Event, State } from '../core/walk.js';
import { button, el, replace, tagLabel } from './dom.js';
import type { Child } from './dom.js';
import { restoreFocus, tagField } from './tag-field.js';

export interface Actions {
  readonly dispatch: (event: Event) => void;
  readonly toggleScan: () => void;
  readonly finish: () => void;
}

export interface Frame {
  // Empty unless the screen has something to say before the auditor acts.
  readonly notice: Child;
  // What sits where the camera goes: the window of upcoming devices, or the
  // viewfinder and whatever the camera has to ask about.
  readonly middle: readonly Child[];
  readonly scanning: boolean;
  readonly pending: number;
}

export function renderWalkScreen(
  host: HTMLElement,
  state: State,
  frame: Frame,
  handlers: Actions,
): void {
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
      frame.pending > 0 ? el('span', { class: 'pending' }, `${frame.pending} queued`) : '',
    ),
    frame.notice,
    lastRow(state),
    ...frame.middle,
    tagField(state, handlers.dispatch),
    actionRow(state, frame.scanning, handlers),
  );

  restoreFocus();
}

// The device just confirmed, faint and out of the way. It is there to be
// checked at a glance, not read: a wrong confirmation is otherwise silent, and
// nothing later in the walk reveals it.
function lastRow(state: State): Child {
  if (state.previous === null) return '';
  const tag = lastConfirmed(state);
  return el(
    'section',
    { class: 'last' },
    el(
      'div',
      { class: 'row' },
      el('span', { class: 'caption' }, 'Last confirmed'),
      tag === undefined ? el('span', { class: 'empty' }, 'nothing yet') : tagLabel(tag),
    ),
  );
}

// The same three actions in the same places on both screens. Only the first
// one's label and job change with the mode: an auditor who has learned where
// Undo is should not have to learn again because the camera is on.
//
// Undo takes back whatever the last action was — a tapped entry, a typed tag,
// a scan — and is disabled rather than hidden when there is nothing to take
// back, because a control that comes and goes is one the auditor has to find
// again each time.
function actionRow(state: State, scanning: boolean, handlers: Actions): HTMLElement {
  const undo = button('Undo last action', () => handlers.dispatch({ kind: 'UNDO' }), 'quiet');
  if (state.previous === null) undo.setAttribute('disabled', '');

  return el(
    'nav',
    {},
    button(
      scanning ? 'Stop scanning' : 'Scan a barcode',
      handlers.toggleScan,
      scanning ? 'primary' : '',
    ),
    undo,
    button('Finish shelf', handlers.finish, 'finish wide'),
  );
}
