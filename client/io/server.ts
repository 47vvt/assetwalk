// Talking to the AssetWalk backend.
//
// Every read fetches one shelf's worth of data and the caller holds it in
// memory only — the device never carries the site's positional history (§5).
// Writes come in two kinds and this module only does one of them: audit
// administration, which happens at a desk and fails in front of somebody.
// Confirmations recorded at the rack go through the outbox instead.

import { parseLocations, parsePositions, parseRoster, parseWalks } from './parse.js';
import type { Location, Walk } from './parse.js';
import type { Position, RosterEntry } from '../core/types.js';

export interface Backend {
  readonly base: string;
  // The auditor's own OAuth token, passed through to ServiceNow by the
  // backend. Null in SQLite deployments, which have no instance to talk to.
  readonly token: string | null;
}

export interface Request {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  // Set by the outbox, so that a retry after an ambiguous timeout cannot
  // double-apply a shelf.
  readonly idempotencyKey?: string;
}

// The one place a request to the backend is built. Returns the response
// unexamined, because the outbox needs the status code to decide whether an
// entry is worth retrying and everything else here just needs it to have
// worked.
export async function request(backend: Backend, spec: Request): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (backend.token !== null) headers['authorization'] = `Bearer ${backend.token}`;
  if (spec.idempotencyKey !== undefined) headers['idempotency-key'] = spec.idempotencyKey;
  if (spec.body !== undefined) headers['content-type'] = 'application/json';

  return fetch(`${backend.base}${spec.path}`, {
    method: spec.method,
    headers,
    // Never send cookies. The backend authenticates the bearer token and
    // nothing else, so an ambient session cannot be used against it.
    credentials: 'omit',
    ...(spec.body === undefined ? {} : { body: JSON.stringify(spec.body) }),
  });
}

async function get(backend: Backend, path: string): Promise<unknown> {
  const response = await request(backend, { method: 'GET', path });
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
  return response.json();
}

async function send(backend: Backend, spec: Request): Promise<void> {
  const response = await request(backend, spec);
  if (!response.ok) throw new Error(`${spec.method} ${spec.path}: ${response.status}`);
}

export async function fetchWalks(backend: Backend): Promise<Walk[]> {
  return parseWalks(await get(backend, '/walks'));
}

// Every location the site knows about, so adding a shelf to a second audit is
// a choice from a list rather than a name typed from memory.
export async function fetchLocations(backend: Backend): Promise<Location[]> {
  return parseLocations(await get(backend, '/locations'));
}

export async function fetchRoster(backend: Backend, walk: string): Promise<RosterEntry[]> {
  return parseRoster(await get(backend, `/walks/${encodeURIComponent(walk)}/roster`));
}

export async function fetchHistory(backend: Backend, location: string): Promise<Position[]> {
  return parsePositions(await get(backend, `/locations/${encodeURIComponent(location)}/history`));
}

// Audit administration is not queued. The outbox exists for confirmations
// recorded in a comms room with no signal; setting an audit up happens at a
// desk, and silently deferring it would leave someone staring at a shelf list
// that does not yet exist anywhere.
export async function createWalk(backend: Backend, walk: string): Promise<void> {
  await send(backend, { method: 'POST', path: '/walks', body: { id: walk, locations: [] } });
}

export async function addLocation(
  backend: Backend,
  walk: string,
  location: { id: string; orientation: string },
): Promise<void> {
  await send(backend, {
    method: 'POST',
    path: `/walks/${encodeURIComponent(walk)}/locations`,
    body: location,
  });
}

export async function removeLocation(
  backend: Backend,
  walk: string,
  location: string,
): Promise<void> {
  await send(backend, {
    method: 'DELETE',
    path: `/walks/${encodeURIComponent(walk)}/locations/${encodeURIComponent(location)}`,
  });
}
