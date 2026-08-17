// The boundary exists so that a backend which changed shape stops the walk
// loudly instead of feeding `undefined` into the reducer. These tests are
// mostly about what it refuses.

import assert from 'node:assert/strict';
import test from 'node:test';

import { base64url } from '../io/auth.js';
import {
  BoundaryError,
  parseConfig,
  parseInstanceURL,
  parsePositions,
  parseReconciliation,
  parseRoster,
} from '../io/parse.js';

test('a well-formed history parses into positions', () => {
  const parsed = parsePositions([
    { location: 'BAY-A3', sequence: 0, asset: 'UOM270313' },
    { location: 'BAY-A3', sequence: 1, asset: 'uom420696' },
  ]);
  assert.equal(parsed.length, 2);
  // Tags are normalised on the way in so the reducer never has to compare
  // case-insensitively, and never has to wonder whether it should.
  assert.equal(parsed[1]?.asset, 'UOM420696');
});

test('a renamed or retyped field stops the walk instead of propagating', () => {
  // This is what "the ServiceNow schema changed" looks like from the client.
  assert.throws(() => parsePositions([{ location: 'BAY-A3', sequence: 0, tag: 'UOM270313' }]));
  assert.throws(() => parsePositions([{ location: 'BAY-A3', sequence: '0', asset: 'UOM270313' }]));
  assert.throws(() => parsePositions([{ location: 'BAY-A3', sequence: 0, asset: null }]));
  assert.throws(() => parsePositions({ positions: [] }));
});

test('the failure names the field that was wrong', () => {
  // A reviewer reading a bug report needs to know which column moved.
  try {
    parsePositions([{ location: 'BAY-A3', sequence: 0, asset: 'not-a-tag' }]);
    assert.ok(false, 'should have thrown');
  } catch (error) {
    assert.ok(error instanceof BoundaryError);
    assert.match(error.message, /positions\[0\]\.asset/);
  }
});

test('a malformed asset tag never reaches the reducer', () => {
  assert.throws(() => parseRoster([{ asset: '', location: null }]));
  assert.throws(() => parseRoster([{ asset: 'UOM12', location: null }]));
  assert.throws(() => parseRoster([{ asset: "'; DROP TABLE --", location: null }]));
  assert.equal(parseRoster([{ asset: 'UOM270313', location: null }])[0]?.location, null);
});

test('reconciliation parses only the candidates the auditor must decide', () => {
  const parsed = parseReconciliation({
    relocated: [{ asset: 'UOM111111', expected_at: 'BAY-A', found_at: 'BAY-C' }],
    candidates: [{ asset: 'UOM222222', location: 'BAY-A' }],
    new_devices: ['UOM333333'],
    unreadable: 2,
  });
  assert.deepEqual(parsed.candidates, [{ asset: 'UOM222222', location: 'BAY-A' }]);
  assert.equal(parsed.unreadable, 2);
});

test('a plaintext instance is refused rather than warned about', () => {
  // PKCE over plaintext defends against nothing at all.
  assert.throws(() => parseInstanceURL('http://example.invalid'));
  assert.throws(() => parseConfig({ backend: '/api', instance: 'http://x.invalid', clientID: 'c' }));
  assert.equal(parseInstanceURL('https://example.invalid').protocol, 'https:');
  // The one exemption, and only for the loopback host.
  assert.equal(parseInstanceURL('http://localhost:8080').hostname, 'localhost');
  assert.throws(() => parseInstanceURL('http://localhost.example.invalid'));
});

test('the PKCE challenge is the base64url SHA-256 of the verifier', async () => {
  // The one vector in RFC 7636 appendix B. Getting the encoding wrong here
  // fails at the identity provider with a message that names neither end.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  assert.equal(base64url(new Uint8Array(digest)), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('base64url drops padding and both URL-unsafe characters', () => {
  assert.equal(base64url(new Uint8Array([255, 255, 255])), '____');
  assert.equal(base64url(new Uint8Array([251, 255, 191])), '-_-_');
  assert.equal(base64url(new Uint8Array([1])), 'AQ');
});
