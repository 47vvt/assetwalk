// The scan screen: the same walk, with a camera where the window was.
//
// Scanning is a mode rather than a one-shot. An auditor who has pulled a
// device out to read its barcode is usually about to do it again, so the
// camera stays live. Everything around it is the walk screen's, in the same
// order and the same places — see walk-frame.ts, which owns that order for
// both screens. The camera is the only thing that changes between the two;
// the auditor's job has not.

import type { State } from '../core/walk.js';
import type { Camera } from '../platform/scanner.js';
import { button, el } from './dom.js';
import type { Child } from './dom.js';
import { renderWalkScreen } from './walk-frame.js';
import type { Actions } from './walk-frame.js';

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
  pending: number,
  handlers: ScanHandlers,
): void {
  // The video keeps the shelf and the app in view at the same time. A
  // fullscreen preview would make the auditor choose between looking at the
  // rack and looking at what they have recorded.
  const viewfinder = el(
    'div',
    { class: 'viewfinder' },
    camera.video,
    el('div', { class: 'target' }),
    // Comms rooms, under-desk labels and the bottom of a rack are dark, and an
    // auditor who cannot turn the light on stops using the camera. On the
    // glass rather than below it, so it costs no room the actions need.
    camera.hasTorch ? button(torch ? 'Torch off' : 'Torch on', handlers.toggleTorch, 'torch') : '',
  );

  // Several codes in one frame. Stacked devices sit close enough together that
  // this is routine, and taking the first one silently marks the wrong asset
  // scanned — so the auditor picks.
  const choice: Child =
    ambiguous.length === 0
      ? ''
      : el(
          'section',
          { class: 'ambiguous' },
          el('h2', { class: 'lead' }, 'More than one code in frame — tap the one you are holding'),
          ...ambiguous.map((value) => button(value, () => handlers.choose(value), 'entry')),
        );

  renderWalkScreen(
    host,
    state,
    { notice: '', middle: [viewfinder, choice], scanning: true, pending },
    handlers,
  );
}
