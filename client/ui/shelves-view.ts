// The shelves one audit covers: walk one, drop one, or add one.
//
// A shelf is a place in the building, not a thing owned by an audit. The site
// keeps its list; an audit picks from it. That is why the second section
// exists — the same rack walked in March and again in August is one shelf with
// one recorded order, and typing its name again would make it two.

import { locationID } from '../core/types.js';
import type { LocationID } from '../core/types.js';
import type { Location, Walk } from '../io/parse.js';
import { button, el, replace } from './dom.js';
import { nameField } from './name-field.js';

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
            row(location.id, `${location.orientation}${location.walked ? ' · walked' : ''}`),
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
              row(location.id, location.orientation),
              () => handlers.add(location.id, location.orientation),
              'entry',
            ),
          ),
        ),

    newShelf(handlers),
  );
}

function row(name: string, detail: string): HTMLElement {
  return el('span', { class: 'row' }, el('strong', {}, name), el('small', {}, detail));
}

// Preselected because it is the overwhelming majority of a university's racks.
// Horizontal stacks are the exception being catered for, not the default being
// chosen against.
const DEFAULT_ORIENTATION = 'vertical';

// Adding a shelf the site has not seen before. Orientation is asked for here
// because it is a fact about how the devices physically sit, and it decides
// which algorithm the walk uses — sticky notes up the shelf, or a printed QR
// sheet per substack. Nothing later can work it out.
function newShelf(handlers: ShelfHandlers): HTMLElement {
  let orientation = DEFAULT_ORIENTATION;

  const { field, commit } = nameField({
    label: 'New shelf name',
    placeholder: 'BAY-A3',
    action: 'Add shelf',
    accepts: (raw) => locationID(raw) !== null,
    submit: (raw) => {
      const id = locationID(raw);
      if (id !== null) handlers.add(id, orientation);
    },
  });

  const choices: HTMLElement[] = [];
  const pick = (value: string, label: string): HTMLElement => {
    const node = button(
      label,
      () => {
        orientation = value;
        for (const other of choices) other.classList.toggle('chosen', other === node);
      },
      value === DEFAULT_ORIENTATION ? 'chosen' : '',
    );
    choices.push(node);
    return node;
  };

  return el(
    'section',
    { class: 'identify' },
    el('h2', { class: 'lead' }, 'Add a shelf the site has not seen'),
    field,
    el(
      'nav',
      {},
      pick(DEFAULT_ORIENTATION, 'Vertical — sticky notes'),
      pick('horizontal', 'Horizontal — QR sheets'),
    ),
    el('nav', {}, commit),
  );
}
