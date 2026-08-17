// Choosing an audit, and creating one.
//
// This is where a walk starts, so it is the one screen that is read rather
// than glanced at — the auditor is at a desk deciding what to do, not standing
// at a rack holding a laptop. It can afford words the walk screen cannot.

import { locationID, walkID } from '../core/types.js';
import type { LocationID, WalkID } from '../core/types.js';
import type { Location, Walk } from '../io/parse.js';
import { button, el, input, replace } from './dom.js';

export interface AuditHandlers {
  readonly open: (walk: WalkID) => void;
  readonly create: (walk: WalkID) => void;
  readonly compose: () => void;
  readonly cancel: () => void;
}

export function renderAudits(host: HTMLElement, walks: readonly Walk[], handlers: AuditHandlers): void {
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

export function renderNewAudit(host: HTMLElement, handlers: AuditHandlers): void {
  const field = input({
    class: 'nameinput',
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'walk-2026-08',
    'aria-label': 'Audit name',
  });
  const create = button('Create audit', () => submit(), 'finish wide');

  const submit = (): void => {
    const id = walkID(field.value.trim());
    if (id !== null) handlers.create(id);
  };

  field.addEventListener('input', () =>
    create.toggleAttribute('disabled', walkID(field.value.trim()) === null),
  );
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });
  create.setAttribute('disabled', '');

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
    el('nav', {}, create),
  );
}

export interface ShelfHandlers {
  readonly walk: (location: LocationID) => void;
  readonly add: (id: LocationID, orientation: string) => void;
  readonly remove: (location: LocationID) => void;
  readonly back: () => void;
}

export function renderShelves(
  host: HTMLElement,
  audit: Walk,
  known: readonly Location[],
  handlers: ShelfHandlers,
): void {
  const covered = new Set(audit.locations.map((location) => location.id));
  const elsewhere = known.filter((location) => !covered.has(location.id));

  replace(
    host,
    el('header', {}, el('h1', {}, audit.id), button('Back', handlers.back)),

    el(
      'section',
      { class: 'window' },
      el('h2', { class: 'lead' }, 'Shelves in this audit'),
      audit.locations.length === 0
        ? el('p', { class: 'empty' }, 'None yet. Add one below to start walking.')
        : '',
      ...audit.locations.map((location) =>
        el(
          'div',
          { class: 'shelf' },
          button(
            el(
              'span',
              { class: 'row' },
              el('strong', {}, location.id),
              el('small', {}, `${location.orientation}${location.walked ? ' · walked' : ''}`),
            ),
            () => handlers.walk(location.id),
            location.walked ? 'entry done' : 'entry',
          ),
          // Takes the shelf out of this audit. It is not a deletion — the
          // shelf and everything recorded about its order survive, which is
          // why this needs no confirmation step.
          button('Remove', () => handlers.remove(location.id), 'quiet'),
        ),
      ),
    ),

    elsewhere.length === 0
      ? ''
      : el(
          'section',
          { class: 'ambiguous' },
          el('h2', { class: 'lead' }, 'Shelves the site already knows'),
          ...elsewhere.map((location) =>
            button(
              el(
                'span',
                { class: 'row' },
                el('strong', {}, location.id),
                el('small', {}, location.orientation),
              ),
              () => handlers.add(location.id, location.orientation),
              'entry',
            ),
          ),
        ),

    newShelf(handlers),
  );
}

// Adding a shelf the site has not seen before. Orientation is asked for here
// because it is a fact about how the devices physically sit, and it decides
// which algorithm the walk uses — sticky notes up the shelf, or a printed QR
// sheet per substack. Nothing later can work it out.
function newShelf(handlers: ShelfHandlers): HTMLElement {
  const field = input({
    class: 'nameinput',
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'BAY-A3',
    'aria-label': 'New shelf name',
  });
  let orientation = 'vertical';

  const add = button('Add shelf', () => {
    const id = locationID(field.value.trim());
    if (id !== null) handlers.add(id, orientation);
  }, 'finish wide');

  const pick = (value: string, label: string): HTMLElement => {
    const node = button(label, () => {
      orientation = value;
      for (const other of choices) other.classList.toggle('chosen', other === node);
    });
    return node;
  };
  const choices = [
    pick('vertical', 'Vertical — sticky notes'),
    pick('horizontal', 'Horizontal — QR sheets'),
  ];
  choices[0]?.classList.add('chosen');

  field.addEventListener('input', () =>
    add.toggleAttribute('disabled', locationID(field.value.trim()) === null),
  );
  add.setAttribute('disabled', '');

  return el(
    'section',
    { class: 'identify' },
    el('h2', { class: 'lead' }, 'Add a shelf the site has not seen'),
    field,
    el('nav', {}, ...choices),
    el('nav', {}, add),
  );
}
