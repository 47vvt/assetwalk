// Reconciliation, after the walk.
//
// The list shown here has already survived the audit-wide pass on the server:
// anything unresolved on one shelf but confirmed on another was relocated, not
// removed, and never reaches this screen. What is left are the tags nobody
// found anywhere, which is the only population where "removed" is a defensible
// answer — and unexplained inventory variance is an incident, not a data-entry
// correction, so each one gets an explicit decision.

import type { AssetTag, LocationID } from '../core/types.js';
import { button, el, replace, tagLabel } from './dom.js';

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
  chosen: ReadonlyMap<AssetTag, Decision>,
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
          { class: 'row' },
          tagLabel(candidate.asset),
          el('small', {}, `last seen ${candidate.location}`),
        ),
        // Every answer is visibly recorded. An auditor who cannot tell whether
        // their tap registered will tap again, and on this screen a double tap
        // is the difference between "gone" and "no answer given".
        el(
          'nav',
          {},
          choice(candidate, chosen, handlers, 'removed', 'Not here — it is gone', 'danger'),
          choice(candidate, chosen, handlers, 'recheck', 'Missed it — go back and look'),
          choice(candidate, chosen, handlers, 'unreadable', 'Here, but I could not read it'),
        ),
      ),
    ),
    button(
      chosen.size === candidates.length
        ? 'Submit reconciliation'
        : `Submit — ${candidates.length - chosen.size} still undecided`,
      handlers.done,
      'finish wide',
    ),
  );
}

function choice(
  candidate: Candidate,
  chosen: ReadonlyMap<AssetTag, Decision>,
  handlers: ReconcileHandlers,
  decision: Decision,
  label: string,
  tone = '',
): HTMLElement {
  const picked = chosen.get(candidate.asset) === decision;
  return button(
    picked ? `${label}  ✓` : label,
    () => handlers.decide(candidate.asset, decision),
    `${tone} ${picked ? 'chosen' : ''}`.trim(),
  );
}
