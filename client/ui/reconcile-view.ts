// Reconciliation, after the walk.
//
// The list shown here has already survived the audit-wide pass on the server:
// anything unresolved on one shelf but confirmed on another was relocated, not
// removed, and never reaches this screen. What is left are the tags nobody
// found anywhere, which is the only population where "removed" is a defensible
// answer — and unexplained inventory variance is an incident, not a data-entry
// correction, so each one gets an explicit decision.

import type { AssetTag, LocationID } from '../core/types.js';
import { button, el, lastFour, replace } from './dom.js';

export interface Candidate {
  readonly asset: AssetTag;
  readonly location: LocationID;
}

export type Decision = 'removed' | 'recheck' | 'unreadable';

export interface ReconcileHandlers {
  readonly decide: (asset: AssetTag, decision: Decision) => void;
  readonly done: () => void;
}

export function renderReconcile(
  host: HTMLElement,
  candidates: readonly Candidate[],
  unreadable: number,
  handlers: ReconcileHandlers,
): void {
  replace(
    host,
    el('header', {}, el('h1', {}, 'Reconciliation')),
    candidates.length === 0
      ? el('p', {}, 'Every expected asset was found. Nothing to reconcile.')
      : el(
          'p',
          {},
          `${candidates.length} assets were not found anywhere in this audit.`,
          // Reported because the auditor already told us these existed. Without
          // it the same fact arrives as an unexplained shortfall.
          unreadable > 0
            ? ` ${unreadable} device${unreadable === 1 ? ' was' : 's were'} present but ` +
              'unreadable during the walk, so expect that many of these to be here.'
            : '',
        ),
    ...candidates.map((candidate) =>
      el(
        'section',
        { class: 'candidate' },
        el(
          'div',
          { class: 'entry' },
          el('strong', {}, lastFour(candidate.asset)),
          el('small', {}, `${candidate.asset} · last seen ${candidate.location}`),
        ),
        el(
          'nav',
          {},
          button('Not here', () => handlers.decide(candidate.asset, 'removed'), 'danger'),
          button('Missed it', () => handlers.decide(candidate.asset, 'recheck')),
          button('Here, note unreadable', () =>
            handlers.decide(candidate.asset, 'unreadable'),
          ),
        ),
      ),
    ),
    button('Submit reconciliation', handlers.done, 'finish'),
  );
}
