// Deployment configuration, fetched at runtime from a file the deployment
// writes.
//
// No instance hostname, client ID or origin appears in this repository, and
// none can: the file is not committed, and this is the only code that reads
// one. A checkout has nothing to leak because a checkout has no config.

import { BoundaryError, field, str } from './parse.js';

export interface Config {
  readonly backend: string;
  // Absent in standalone deployments. A SQLite backend has no ServiceNow
  // instance to authenticate against, and putting a sign-in step in front of
  // it would be theatre — there would be nothing on the other side of it.
  readonly oauth: { readonly instance: string; readonly clientID: string } | null;
}

export function parseConfig(raw: unknown): Config {
  const backend = str(raw, 'config', 'backend');
  if (field(raw, 'config', 'instance') === undefined) return { backend, oauth: null };

  const instance = str(raw, 'config', 'instance');
  parseInstanceURL(instance);
  return { backend, oauth: { instance, clientID: str(raw, 'config', 'clientID') } };
}

// PKCE defends against an attacker who captures the redirect but is not on the
// network path. Over plaintext it defends against nothing, so a non-HTTPS
// instance is rejected outright rather than warned about. `http://localhost`
// is the standard development exemption and the only one.
export function parseInstanceURL(raw: string): URL {
  const url = new URL(raw);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new BoundaryError(`instance URL must be https: ${raw}`);
  }
  return url;
}
