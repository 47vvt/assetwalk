// The scan screen: the same walk, with a camera where the window was.
//
// Scanning is a mode rather than a one-shot. An auditor who has pulled a
// device out to read its barcode is usually about to do it again, so the
// camera stays live and each read lands underneath it. The rest of the screen
// is deliberately the same as the walk screen — the last confirmed device and
// the tag field — because the auditor's job has not changed, only how they are
// reading the label.

import type { Event, State } from '../core/walk.js';
import type { Camera } from '../platform/scanner.js';
import { button, el, replace } from './dom.js';
import { lastRow, restoreFocus, tagField } from './entry.js';
import { undoButton } from './walk-view.js';

export interface ScanHandlers {
  readonly dispatch: (event: Event) => void;
  readonly choose: (value: string) => void;
  readonly close: () => void;
}

export function renderScan(
  host: HTMLElement,
  state: State,
  camera: Camera,
  ambiguous: readonly string[],
  handlers: ScanHandlers,
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
    ),

    // The video keeps the shelf and the app in view at the same time. A
    // fullscreen preview would make the auditor choose between looking at the
    // rack and looking at what they have recorded.
    el('div', { class: 'viewfinder' }, camera.video, el('div', { class: 'target' })),

    camera.hasTorch
      ? el(
          'nav',
          {},
          button('Torch on', () => void camera.setTorch(true), 'wide'),
        )
      : '',

    // Several codes in one frame. Stacked devices sit close enough together
    // that this is routine, and taking the first one silently marks the wrong
    // asset scanned — so the auditor picks.
    ambiguous.length === 0
      ? ''
      : el(
          'section',
          { class: 'ambiguous' },
          el('h2', { class: 'lead' }, 'More than one code in frame — tap the one you are holding'),
          ...ambiguous.map((value) => button(value, () => handlers.choose(value), 'entry')),
        ),

    lastRow(state),

    // Manual entry stays available here: a barcode that will not read is
    // exactly when the auditor needs to key the tag, and sending them back to
    // the other screen to do it would be the wrong moment to change screens.
    tagField(state, handlers.dispatch),

    el(
      'nav',
      {},
      undoButton(state, handlers.dispatch),
      button('Stop scanning', handlers.close, 'primary'),
    ),
  );

  restoreFocus();
}
