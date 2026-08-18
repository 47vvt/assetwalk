// The offline shell and the app manifest.
//
// The service worker is the one piece of this project that can quietly break
// §5. Caching is exactly the act of putting data on a device and leaving it
// there, and a worker that cached an API response would keep a shelf's worth
// of asset tags long after the walk that was allowed to see them. So the rule
// is tested rather than commented.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
const manifest: unknown = JSON.parse(
  readFileSync(new URL('../../manifest.webmanifest', import.meta.url), 'utf8'),
);
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

function field(raw: unknown, key: string): unknown {
  assert.ok(typeof raw === 'object' && raw !== null);
  return (raw as Record<string, unknown>)[key];
}

test('the service worker refuses to cache anything under /api', () => {
  // Not a style preference. Without this the device holds positional history
  // indefinitely, which is the thing the backend exists to prevent.
  assert.match(worker, /\/api\//);
  assert.match(worker, /pathname\.includes\('\/api\/'\)/);
});

test('deployment config is network first, cached only as a fallback', () => {
  // Online it is always fresh, so a backend that moves is picked up. Offline
  // the last known copy is used — without it the app would fall back to its
  // fixture and put an auditor on a demo shelf without saying so.
  assert.match(worker, /isConfig/);
  assert.ok(!worker.includes("'./config.json',"), 'config.json is not pre-cached');
  assert.match(worker, /await fetch\(request\)/);
});

test('a navigation resolves to the cached index whatever its query is', () => {
  // Every route renders the same document. Matching on the full URL would
  // never hit, because ?walk=… is part of the cache key.
  assert.match(worker, /request\.mode === 'navigate'/);
});

test('only same-origin GETs reach the cache at all', () => {
  assert.match(worker, /request\.method !== 'GET'/);
  assert.match(worker, /url\.origin === self\.location\.origin/);
});

test('the shell lists what the first screen needs', () => {
  for (const entry of ['./index.html', './app.css', './dist/main.js']) {
    assert.ok(worker.includes(`'${entry}'`), entry);
  }
});

test('the manifest installs to a home screen on both platforms', () => {
  assert.equal(field(manifest, 'display'), 'standalone');
  assert.equal(field(manifest, 'scope'), './');

  const icons = field(manifest, 'icons');
  assert.ok(Array.isArray(icons));
  const purposes = icons.map((icon) => field(icon, 'purpose'));
  // Android crops an icon without a maskable variant to a circle and takes a
  // bite out of the artwork.
  assert.ok(purposes.includes('maskable'), 'Android needs a maskable icon');
  assert.ok(purposes.includes('any'));
});

test('iOS is given the things it reads instead of the manifest', () => {
  // iOS reads none of the manifest: no display mode, no icons, no theme.
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /viewport-fit=cover/);
});

test('the strict CSP still covers the pieces the shell added', () => {
  assert.match(html, /manifest-src 'self'/);
  assert.match(html, /worker-src 'self'/);
  // The claim the README makes is that this client cannot send scan data
  // anywhere else. Nothing added for mobile is allowed to widen it.
  assert.match(html, /connect-src 'self'/);
  assert.ok(!/connect-src[^;]*\*/.test(html), 'connect-src must not be widened');
});
