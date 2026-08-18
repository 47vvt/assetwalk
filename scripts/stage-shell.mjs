// Copies the built client into the shell's web directory.
//
// The shell has no source of its own — that is the point of §16. It cannot
// fork the codebase because there is nothing here to fork: this copies the
// same files a browser is served, and `native/www` is generated, never edited
// and never committed.

import { access, cp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = join(root, 'client');
const www = join(root, 'native', 'www');

// Everything a browser is served, and nothing else. config.json is absent by
// design: it is deployment state, and baking one instance's hostname into a
// signed binary is how a build ends up working for exactly one customer.
const SHELL = [
  'index.html',
  'callback.html',
  'app.css',
  'manifest.webmanifest',
  'favicon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'sw.js',
  'dist',
];

await access(join(client, 'dist')).catch(() => {
  throw new Error('client is not built: run `npm run build` at the repository root first');
});

await rm(www, { recursive: true, force: true });
for (const entry of SHELL) {
  await cp(join(client, entry), join(www, entry), { recursive: true });
}
console.log(`staged ${SHELL.length} entries into native/www`);
