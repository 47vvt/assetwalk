// Choosing an audit.
//
// This is where a walk starts, so it is one of the screens that is read rather
// than glanced at — the auditor is at a desk deciding what to do, not standing
// at a rack holding a laptop. It can afford words the walk screen cannot.

import type { WalkID } from '../core/types.js';
import type { Walk } from '../io/parse.js';
import { button, el, replace } from './dom.js';

export interface AuditHandlers {
  readonly open: (walk: WalkID) => void;
  readonly create: (walk: WalkID) => void;
  readonly compose: () => void;
  readonly cancel: () => void;
}

export function renderAudits(
  host: HTMLElement,
  walks: readonly Walk[],
  handlers: AuditHandlers,
): void {
  replace(
    host,
    el('header', {}, el('h1', {}, 'Audits')),
    walks.length === 0
      ? el('p', { class: 'empty' }, 'No audits yet. Create one, then add the shelves it covers.')
      : '',
    ...walks.map((walk) => {
      const walked = walk.locations.filter((location) => location.walked).length;
      return button(
        el(
          'span',
          { class: 'row' },
          el('strong', {}, walk.id),
          el(
            'small',
            {},
            walk.locations.length === 0
              ? 'no shelves yet'
              : `${walked} of ${walk.locations.length} shelves walked`,
          ),
        ),
        () => handlers.open(walk.id),
        'entry',
      );
    }),
    el('nav', {}, button('New audit', handlers.compose, 'finish wide')),
  );
}
