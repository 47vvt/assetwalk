// Algorithm 2's output: turning a walked horizontal stack into printable
// substack sheets.
//
// Regeneration is real work — someone carries these back to the stacks and
// places them — so the screen ends at a PDF, not at a preview.

import { SUBSTACK_MAX, SUBSTACK_MIN, planSubstacks } from '../core/sheet.js';
import type { Sheet } from '../core/sheet.js';
import type { AssetTag, LocationID, WalkID } from '../core/types.js';
import { sheetsPDF } from '../pdf/sheet-page.js';
import { button, el, replace } from './dom.js';

export function renderSheets(
  host: HTMLElement,
  walk: WalkID,
  location: LocationID,
  stack: readonly AssetTag[],
  onRegistered: (sheets: readonly Sheet[]) => void,
): void {
  const printedAt = new Date().toISOString().slice(0, 10);
  const sheets: Sheet[] = planSubstacks(stack).map((members, i) => ({
    id: `${location}-${printedAt}-${i + 1}`,
    walk,
    location,
    printedAt,
    members,
  }));

  replace(
    host,
    el('header', {}, el('h1', {}, `${location} — QR sheets`)),
    el(
      'p',
      {},
      `${stack.length} devices in ${sheets.length} substacks of ${SUBSTACK_MIN}–${SUBSTACK_MAX}. ` +
        'One sheet per page. Place each above the tag printed at the top of its page.',
    ),
    ...sheets.map((sheet) =>
      el(
        'section',
        { class: 'candidate' },
        el(
          'div',
          { class: 'entry' },
          el('strong', {}, `${sheet.members.length}`),
          el('small', {}, `above ${sheet.members[0] ?? ''} · sheet ${sheet.id}`),
        ),
      ),
    ),
    button('Download PDF', () => download(sheets, `${location}-sheets.pdf`), 'primary'),
    button('Register as printed', () => onRegistered(sheets), 'finish'),
  );
}

function download(sheets: readonly Sheet[], filename: string): void {
  const url = URL.createObjectURL(sheetsPDF(sheets));
  const link = el('a', { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}
