// The boundary exists so that a backend which changed shape stops the walk
// loudly instead of feeding `undefined` into the reducer. These tests are
// mostly about what it refuses.

import assert from 'node:assert/strict';
import test from 'node:test';

import { base64url } from '../io/auth.js';
import { parseConfig, parseInstanceURL } from '../io/config.js';
import {
  BoundaryError,
  parseLocations,
  parsePositions,
  parseRoster,
  parseWalks,
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

test('a standalone config asks for no sign-in', () => {
  // A SQLite backend has no instance to authenticate against. Demanding a
  // sign-in for it would put a door in front of an empty room.
  const standalone = parseConfig({ backend: '/api' });
  assert.equal(standalone.oauth, null);
  assert.equal(standalone.backend, '/api');

  const federated = parseConfig({
    backend: '/api',
    instance: 'https://example.invalid',
    clientID: 'assetwalk',
  });
  assert.equal(federated.oauth?.clientID, 'assetwalk');
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

test('audits parse with the shelves they cover', () => {
  const walks = parseWalks([
    {
      id: 'walk-2026-08',
      locations: [
        { id: 'BAY-A3', orientation: 'vertical', walked: true },
        { id: 'STACK-C7', orientation: 'horizontal', walked: false },
      ],
    },
    { id: 'walk-2026-09', locations: [] },
  ]);

  assert.equal(walks.length, 2);
  assert.equal(walks[0]?.locations[0]?.walked, true);
  assert.equal(walks[0]?.locations[1]?.orientation, 'horizontal');
  // An audit that covers nothing yet is normal, not malformed: it is the one
  // somebody has just created and is about to add shelves to.
  assert.deepEqual(walks[1]?.locations, []);
});

test('an unknown orientation stops the walk rather than guessing', () => {
  // Orientation decides whether a shelf is walked by sticky note or by printed
  // QR sheet. Defaulting it would silently run the wrong algorithm.
  assert.throws(() => parseLocations([{ id: 'BAY-A3', orientation: 'diagonal', walked: false }]));
  assert.throws(() => parseLocations([{ id: 'BAY-A3', walked: false }]));
  try {
    parseLocations([{ id: 'BAY-A3', orientation: 'sideways', walked: false }]);
    assert.ok(false, 'should have thrown');
  } catch (error) {
    assert.ok(error instanceof BoundaryError);
    assert.match(error.message, /locations\[0\]\.orientation/);
  }
});

test('a malformed shelf name never reaches a request path', () => {
  assert.throws(() => parseLocations([{ id: '../etc', orientation: 'vertical', walked: false }]));
  assert.throws(() => parseWalks([{ id: '', locations: [] }]));
});
