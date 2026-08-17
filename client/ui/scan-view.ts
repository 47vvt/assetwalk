// The scan screen: the same walk, with a camera where the window was.
//
// Scanning is a mode rather than a one-shot. An auditor who has pulled a
// device out to read its barcode is usually about to do it again, so the
// camera stays live and each read lands underneath it. Everything below the
// viewfinder — the last confirmed device, the tag field, the three actions —
// is the walk screen's, in the same order and the same places. The auditor's
// job has not changed, only how they are reading the label.

import type { State } from '../core/walk.js';
import type { Camera } from '../platform/scanner.js';
import { button, el, replace } from './dom.js';
import { actions, lastRow, restoreFocus, tagField } from './entry.js';
import type { Actions } from './entry.js';

export interface ScanHandlers extends Actions {
  readonly choose: (value: string) => void;
  readonly toggleTorch: () => void;
}

export function renderScan(
  host: HTMLElement,
  state: State,
  camera: Camera,
  torch: boolean,
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
    el(
      'div',
      { class: 'viewfinder' },
      camera.video,
      el('div', { class: 'target' }),
      // Comms rooms, under-desk labels and the bottom of a rack are dark, and
      // an auditor who cannot turn the light on stops using the camera. On the
      // glass rather than below it, so it costs no room the actions need.
      camera.hasTorch
        ? button(torch ? 'Torch off' : 'Torch on', handlers.toggleTorch, 'torch')
        : '',
    ),

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

    actions(state, true, handlers),
  );

  restoreFocus();
}
