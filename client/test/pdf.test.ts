// A PDF that renders in the one reader you tried is not the same as a valid
// PDF. The xref byte offsets and the stream /Length are the two things that
// are wrong silently — most readers repair them, and the printer at the other
// end may not — so they are checked here against the actual bytes.

import assert from 'node:assert/strict';
import test from 'node:test';

import { assetTag, locationID, walkID } from '../core/types.js';
import type { AssetTag } from '../core/types.js';
import { planSubstacks } from '../core/sheet.js';
import type { Sheet } from '../core/sheet.js';
import { sheetsPDF } from '../pdf/sheet-page.js';
import { PAGE, document, fill, text } from '../pdf/writer.js';

function must<T extends string>(value: T | null): T {
  if (value === null) throw new Error('test fixture is malformed');
  return value;
}

function tag(digits: number): AssetTag {
  return must(assetTag(`UOM${String(digits).padStart(6, '0')}`));
}

async function render(pdf: Blob): Promise<string> {
  return new TextDecoder('latin1').decode(await pdf.arrayBuffer());
}

function sheets(count: number): Sheet[] {
  const stack = Array.from({ length: count * 15 }, (_, i) => tag(i + 1));
  return planSubstacks(stack).map((members, i) => ({
    id: `BAY-A3-2026-01-01-${i + 1}`,
    walk: must(walkID('walk-1')),
    location: must(locationID('BAY-A3')),
    printedAt: '2026-01-01',
    members,
  }));
}

test('the cross-reference table points at the objects it claims to', async () => {
  const raw = await render(document([[text(20, 20, 12, 'one')], [fill(0, 0, 10, 10)]]));
  const bytes = new TextEncoder().encode(raw);

  assert.ok(raw.startsWith('%PDF-'));
  assert.ok(raw.endsWith('%%EOF\n'));

  // Not lastIndexOf('xref') — the trailer's `startxref` keyword contains it.
  const table = raw.slice(raw.lastIndexOf('\nxref\n'));
  const offsets = [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  // Catalog, page tree, font, then a page object and a content stream each.
  assert.equal(offsets.length, 3 + 2 * 2);

  offsets.forEach((offset, i) => {
    const found = new TextDecoder('latin1').decode(bytes.slice(offset, offset + 10));
    assert.ok(found.startsWith(`${i + 1} 0 obj`), `object ${i + 1} at byte ${offset}: ${found}`);
  });

  const startxref = Number(raw.slice(raw.lastIndexOf('startxref\n') + 10).split('\n')[0]);
  assert.ok(raw.slice(startxref).startsWith('xref\n'));
});

test('every stream declares its true byte length', async () => {
  const raw = await render(sheetsPDF(sheets(2)));
  const streams = [...raw.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)];

  assert.ok(streams.length > 0);
  for (const [, declared, body] of streams) {
    assert.equal(new TextEncoder().encode(body ?? '').length, Number(declared));
  }
});

test('a sheet page carries what someone needs to place it', async () => {
  const [sheet] = sheets(1);
  assert.ok(sheet !== undefined);
  const raw = await render(sheetsPDF([sheet]));

  const first = sheet.members[0];
  const last = sheet.members[sheet.members.length - 1];
  assert.ok(first !== undefined && last !== undefined);

  assert.ok(raw.includes(`(PLACE ABOVE  ${first})`), 'where the sheet goes');
  assert.ok(raw.includes(`(${sheet.location})`), 'which location');
  assert.ok(raw.includes(`(${String(sheet.members.length)})`), 'the count to check against');
  assert.ok(raw.includes(`(${last})`), 'the bottom tag, to localise a mismatch');
  // Paper is free and a creased QR is unrecoverable: the full list is the way
  // back to a working audit. Numbered, so the auditor can count down the
  // substack against the page without losing their place.
  sheet.members.forEach((member, i) =>
    assert.ok(raw.includes(`(${i + 1}. ${member})`), member),
  );
});

test('one page per sheet, so each can be carried to its own substack', async () => {
  const raw = await render(sheetsPDF(sheets(3)));
  const pages = [...raw.matchAll(/\/Type \/Page[^s]/g)];
  assert.equal(pages.length, sheets(3).length);
  assert.ok(raw.includes(`/Count ${sheets(3).length}`));
});

test('QR modules are drawn as vectors and stay inside the page', async () => {
  const [sheet] = sheets(1);
  assert.ok(sheet !== undefined);
  const raw = await render(sheetsPDF([sheet]));

  const rects = [...raw.matchAll(/^([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f$/gm)];
  // A version-9 symbol is 53×53; anything in this range means real modules
  // were emitted rather than an image being embedded.
  assert.ok(rects.length > 200, `${rects.length} modules`);
  for (const [, x, y, w, h] of rects) {
    assert.ok(Number(x) >= 0 && Number(x) + Number(w) <= PAGE.width);
    assert.ok(Number(y) >= 0 && Number(y) + Number(h) <= PAGE.height);
  }
});

test('text that would break the content stream is escaped', async () => {
  const raw = await render(document([[text(10, 10, 12, 'a (b) \\ c')]]));
  assert.ok(raw.includes('(a \\(b\\) \\\\ c)'));
});
