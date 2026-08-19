// Creating an audit: a name, and nothing else.
//
// What the audit covers is deliberately not asked for here. Shelves are added
// on the next screen and can keep being added while the audit is in progress,
// so making the auditor decide the whole scope up front would be asking for a
// commitment the tool does not need.

import { walkID } from '../core/types.js';
import { button, el, replace } from './dom.js';
import { nameField } from './name-field.js';
import type { AuditHandlers } from './audits-view.js';

export function renderNewAudit(host: HTMLElement, handlers: AuditHandlers): void {
  const { field, commit } = nameField({
    label: 'Audit name',
    placeholder: 'walk-2026-08',
    action: 'Create audit',
    accepts: (raw) => walkID(raw) !== null,
    submit: (raw) => {
      const id = walkID(raw);
      if (id !== null) handlers.create(id);
    },
  });

  replace(
    host,
    el('header', {}, el('h1', {}, 'New audit'), button('Back', handlers.cancel)),
    el(
      'p',
      {},
      'Name it after when it runs, not what it covers — the shelves it covers ' +
        'are added next and can change while it is in progress.',
    ),
    el('section', { class: 'identify' }, field),
    el('nav', {}, commit),
  );
}
