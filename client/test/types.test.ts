// The tag shape drives how many cells the entry field shows and what the
// label to their left says. Getting it wrong means an auditor cannot type a
// tag that exists, so it is derived from the walk's own data and checked here.

import assert from 'node:assert/strict';
import test from 'node:test';

import { assetTag, digitsOf, tagShape } from '../core/types.js';

test('a fleet with one prefix yields that prefix and its digit count', () => {
  const shape = tagShape(['UOM270313', 'UOM420696', 'UOM118820']);
  assert.deepEqual(shape, { prefix: 'UOM', digits: 6 });
});

test('the prefix is the part every tag shares, not the first one seen', () => {
  // Two sites in one walk: nothing common is left to put on the label, so the
  // auditor is not shown a prefix that only some devices carry.
  assert.deepEqual(tagShape(['UOM270313', 'ANU270313']), { prefix: '', digits: 6 });
  assert.deepEqual(tagShape(['UOMA1234', 'UOMB1234']), { prefix: 'UOM', digits: 4 });
});

test('a walk with no tags still offers somewhere to record a new device', () => {
  const shape = tagShape([]);
  assert.equal(shape.prefix, '');
  assert.ok(shape.digits >= 4, 'must allow at least the shortest legal tag');
});

test('the widest tag decides the cell count, so none is untypeable', () => {
  const shape = tagShape(['UOM1234', 'UOM123456789']);
  assert.equal(shape.digits, 9);
  // A shorter tag is still reachable: leftover cells simply stay empty, and
  // the assembled value is a valid tag before they are filled.
  assert.notEqual(assetTag(shape.prefix + '1234'), null);
});

test('a shape round-trips with the tags it was derived from', () => {
  const tags = ['UOM270313', 'UOM420696'];
  const shape = tagShape(tags);
  for (const tag of tags) {
    const typed = tag.slice(shape.prefix.length);
    assert.equal(typed.length, shape.digits);
    assert.equal(assetTag(shape.prefix + typed), tag);
  }
});

test('digits are what people and scanners agree on', () => {
  assert.equal(digitsOf('UOM270313'), '270313');
  assert.equal(digitsOf('0012345'), '12345');
});
