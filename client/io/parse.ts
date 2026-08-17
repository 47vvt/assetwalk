// The validation boundary. Types are erased at runtime, so every value
// crossing into the app — API responses, QR payloads, URL params, config — is
// parsed here and nowhere else. Failure throws by design: a changed backend
// schema must stop the walk loudly, not propagate `undefined` into the reducer
// and quietly corrupt an audit record.

import { assetTag, locationID, walkID } from '../core/types.js';
import type { AssetTag, LocationID, Position, RosterEntry, WalkID } from '../core/types.js';

export class BoundaryError extends Error {}

function fail(path: string, value: unknown): never {
  throw new BoundaryError(`${path}: unexpected ${JSON.stringify(value) ?? typeof value}`);
}

function field(record: unknown, path: string, key: string): unknown {
  if (typeof record !== 'object' || record === null) fail(path, record);
  return (record as Record<string, unknown>)[key];
}

function str(record: unknown, path: string, key: string): string {
  const value = field(record, path, key);
  return typeof value === 'string' ? value : fail(`${path}.${key}`, value);
}

function int(record: unknown, path: string, key: string): number {
  const value = field(record, path, key);
  return Number.isInteger(value) ? (value as number) : fail(`${path}.${key}`, value);
}

function list(raw: unknown, path: string): unknown[] {
  return Array.isArray(raw) ? raw : fail(path, raw);
}

function tag(record: unknown, path: string, key: string): AssetTag {
  return assetTag(str(record, path, key)) ?? fail(`${path}.${key}`, field(record, path, key));
}

function place(record: unknown, path: string, key: string): LocationID {
  return locationID(str(record, path, key)) ?? fail(`${path}.${key}`, field(record, path, key));
}

export function parsePositions(raw: unknown): Position[] {
  return list(raw, 'positions').map((entry, i) => ({
    location: place(entry, `positions[${i}]`, 'location'),
    sequence: int(entry, `positions[${i}]`, 'sequence'),
    asset: tag(entry, `positions[${i}]`, 'asset'),
  }));
}

export function parseRoster(raw: unknown): RosterEntry[] {
  return list(raw, 'roster').map((entry, i) => {
    const at = field(entry, `roster[${i}]`, 'location');
    return {
      asset: tag(entry, `roster[${i}]`, 'asset'),
      location: at === null ? null : place(entry, `roster[${i}]`, 'location'),
    };
  });
}

export interface Reconciliation {
  readonly candidates: readonly { asset: AssetTag; location: LocationID }[];
  readonly unreadable: number;
}

// Only the candidates reach the auditor. Relocations and new devices are in
// the response and are deliberately not surfaced mid-reconciliation: a device
// found on another shelf needs no decision, and putting it on screen invites
// one.
export function parseReconciliation(raw: unknown): Reconciliation {
  return {
    candidates: list(field(raw, 'reconciliation', 'candidates'), 'candidates').map(
      (entry, i) => ({
        asset: tag(entry, `candidates[${i}]`, 'asset'),
        location: place(entry, `candidates[${i}]`, 'location'),
      }),
    ),
    unreadable: int(raw, 'reconciliation', 'unreadable'),
  };
}

export function parseWalkID(raw: string | null): WalkID {
  return walkID(raw ?? '') ?? fail('walk', raw);
}

export interface Config {
  readonly backend: string;
  // Absent in standalone deployments. A SQLite backend has no ServiceNow
  // instance to authenticate against, and putting a sign-in step in front of
  // it would be theatre — there would be nothing on the other side of it.
  readonly oauth: { readonly instance: string; readonly clientID: string } | null;
}

// Fetched at runtime from a file the deployment writes. No instance hostname,
// client ID or origin appears in this repository, and none can: the file is
// not committed, and this is the only code that reads one.
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
