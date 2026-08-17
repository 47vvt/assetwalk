import assert from 'node:assert/strict';
import test from 'node:test';

import { assetTag, digitsOf } from '../core/types.js';
import type { AssetTag } from '../core/types.js';
import {
  SUBSTACK_MAX,
  SUBSTACK_MIN,
  decodeSheetPayload,
  encodeSheetPayload,
  matchRoster,
  planSubstacks,
} from '../core/sheet.js';

function tag(digits: number): AssetTag {
  const parsed = assetTag(`UOM${String(digits).padStart(6, '0')}`);
  if (parsed === null) throw new Error('test fixture is malformed');
  return parsed;
}

function stack(size: number): AssetTag[] {
  return Array.from({ length: size }, (_, i) => tag(i + 1));
}

test('substacks stay inside the size band for every realistic stack', () => {
  for (let size = SUBSTACK_MIN; size <= 200; size++) {
    const substacks = planSubstacks(stack(size));
    const sizes = substacks.map((members) => members.length);
    assert.ok(Math.max(...sizes) <= SUBSTACK_MAX, `size ${size}`);
    assert.ok(Math.min(...sizes) >= SUBSTACK_MIN, `size ${size}`);
    // Even sizes: a short tail substack wastes a sheet and is the easiest one
    // to miscount against its neighbours.
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `size ${size}`);
    assert.equal(
      substacks.flat().length,
      size,
      `size ${size}: every device belongs to exactly one substack`,
    );
  }
});

test('substacks preserve stack order, top first', () => {
  const substacks = planSubstacks(stack(45));
  assert.deepEqual(substacks.flat(), stack(45));
});

test('a stack shorter than one substack is a single sheet', () => {
  assert.deepEqual(planSubstacks(stack(4)), [stack(4)]);
  assert.deepEqual(planSubstacks([]), []);
});

test('a sheet payload round-trips through numeric-only encoding', () => {
  const members = stack(20);
  const payload = encodeSheetPayload(members);

  // Numeric mode only accepts digits, and it is what makes 40 tags fit on a
  // version 9 symbol. A non-digit here silently costs 40% of the density.
  assert.match(payload, /^[0-9]+$/);
  assert.deepEqual(decodeSheetPayload(payload), members.map(digitsOf));
});

test('a corrupted payload is rejected rather than half-read', () => {
  const payload = encodeSheetPayload(stack(12));

  assert.equal(decodeSheetPayload(''), null);
  assert.equal(decodeSheetPayload('not digits'), null);
  assert.equal(decodeSheetPayload(payload.slice(0, -1)), null);
  // A transposition inside the body: the weighted checksum exists for exactly
  // this, because an unweighted sum would not notice.
  const body = payload.slice(0, -4);
  const swapped = body.slice(0, 8) + body[9] + body[8] + body.slice(10);
  assert.notEqual(swapped, body);
  assert.equal(decodeSheetPayload(swapped + payload.slice(-4)), null);
});

test('a scanned sheet resolves against the roster by digits alone', () => {
  const members = stack(15);
  const decoded = decodeSheetPayload(encodeSheetPayload(members));
  assert.ok(decoded !== null);

  // The roster carries full tags; the sheet carries digits. The site prefix is
  // never in the payload, so matching has to work without it.
  const matched = matchRoster(decoded, [...members, tag(900_001)]);
  assert.equal(matched.size, members.length);
  for (const member of members) assert.equal(matched.get(digitsOf(member)), member);
});

test('a device not on the roster does not resolve to anything', () => {
  const decoded = decodeSheetPayload(encodeSheetPayload([tag(1), tag(2)]));
  assert.ok(decoded !== null);
  assert.equal(matchRoster(decoded, [tag(1)]).size, 1);
});
