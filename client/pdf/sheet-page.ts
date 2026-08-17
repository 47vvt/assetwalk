// Laying out one QR substack sheet, one sheet per page.
//
// Someone has to walk back to the stacks with this stack of paper and put each
// page in the right slot. If the page does not tell them where it goes, they
// have a puzzle rather than a task — which is why the location and "PLACE
// ABOVE <tag>" are the largest things on it.

import { MM, PAGE, document, fill, text } from './writer.js';
import type { Op } from './writer.js';
import { encodeSheetPayload } from '../core/sheet.js';
import type { Sheet } from '../core/sheet.js';
import qrcodegen from '../vendor/qr-encoder.js';

// 1.6mm per module. The floor for reliable phone-camera reads off laser print
// is about 0.5mm; this is three times that, because the sheet is read from the
// front of a stack at arm's length in bad light, and because a page holding
// forty tags still has half of itself spare. Nothing is gained by printing a
// smaller code here.
const MODULE = 1.6 * MM;

// ISO/IEC 18004 requires 4 empty modules on every side. Scanners use the quiet
// zone to find the symbol's edge, and printing text or a border into it is the
// most common reason a code that looks fine will not read. Do not reclaim it.
const QUIET = 4;

// Level M tolerates ~15% damaged codewords. Enough for a creased sheet, and
// cheap: the payload still fits inside version 9 at 40 tags.
const ECC = qrcodegen.QrCode.Ecc.MEDIUM;

const MARGIN = 15 * MM;

export function sheetsPDF(sheets: readonly Sheet[]): Blob {
  return document(sheets.map(page));
}

function page(sheet: Sheet): Op[] {
  const ops: Op[] = [];
  const first = sheet.members[0];
  const last = sheet.members[sheet.members.length - 1];
  if (first === undefined || last === undefined) return ops;

  let y = PAGE.height - MARGIN;

  y -= 16 * MM;
  ops.push(text(MARGIN, y, 34, sheet.location));
  y -= 13 * MM;
  ops.push(text(MARGIN, y, 26, `PLACE ABOVE  ${first}`));

  // The count is the whole integrity check for this algorithm: the auditor
  // counts the substack by eye in two seconds and compares. Match means trust
  // the group; mismatch means that substack falls back to individual scanning.
  // It has to be readable across a room, hence the largest type on the page.
  y -= 26 * MM;
  ops.push(text(MARGIN, y, 60, `${sheet.members.length}`));
  ops.push(text(MARGIN + 44 * MM, y + 6 * MM, 13, 'DEVICES BELOW THIS SHEET.'));
  ops.push(text(MARGIN + 44 * MM, y - 1 * MM, 13, 'COUNT THEM. IF THE COUNT'));
  ops.push(text(MARGIN + 44 * MM, y - 8 * MM, 13, 'DIFFERS, SCAN INDIVIDUALLY.'));

  const qr = qrcodegen.QrCode.encodeSegments(
    [qrcodegen.QrSegment.makeNumeric(encodeSheetPayload(sheet.members))],
    ECC,
  );
  y -= (qr.size + QUIET * 2) * MODULE + 10 * MM;
  ops.push(...modules(qr, MARGIN, y));

  // Top and bottom tag in plain text: when the count is wrong, these localise
  // which end of the substack moved without reading the whole list.
  const beside = MARGIN + (qr.size + QUIET * 2) * MODULE + 8 * MM;
  ops.push(text(beside, y + (qr.size + QUIET) * MODULE - 12 * MM, 12, 'TOP OF SUBSTACK'));
  ops.push(text(beside, y + (qr.size + QUIET) * MODULE - 20 * MM, 20, first));
  ops.push(text(beside, y + (qr.size + QUIET) * MODULE - 34 * MM, 12, 'BOTTOM OF SUBSTACK'));
  ops.push(text(beside, y + (qr.size + QUIET) * MODULE - 42 * MM, 20, last));

  // Paper is free and a creased QR is not recoverable. The full list is the
  // path back to a working audit when the code will not read.
  y -= 12 * MM;
  ops.push(text(MARGIN, y, 11, 'CONTENTS, TOP FIRST'));
  y -= 7 * MM;
  const rows = Math.ceil(sheet.members.length / 4);
  sheet.members.forEach((tag, i) => {
    const column = Math.floor(i / rows);
    ops.push(text(MARGIN + column * 45 * MM, y - (i % rows) * 6 * MM, 11, `${i + 1}. ${tag}`));
  });

  ops.push(
    text(
      MARGIN,
      MARGIN,
      9,
      `sheet ${sheet.id} · walk ${sheet.walk} · printed ${sheet.printedAt}`,
    ),
  );
  return ops;
}

// The encoder returns a boolean module matrix and its own image rendering is
// unused: walking the grid into filled rectangles gives vector output that
// stays crisp at any size, with no image to embed and no resampling between
// here and the printer.
function modules(qr: qrcodegen.QrCode, x: number, y: number): Op[] {
  const ops: Op[] = [];
  const origin = { x: x + QUIET * MODULE, y: y + QUIET * MODULE };
  for (let row = 0; row < qr.size; row++) {
    for (let column = 0; column < qr.size; column++) {
      if (!qr.getModule(column, row)) continue;
      ops.push(
        fill(
          origin.x + column * MODULE,
          // The matrix counts rows downward from the top; PDF user space
          // counts upward from the bottom.
          origin.y + (qr.size - 1 - row) * MODULE,
          MODULE,
          MODULE,
        ),
      );
    }
  }
  return ops;
}
