// Talking to the AssetWalk backend.
//
// Reads fetch one shelf at a time and the caller holds the result in memory
// only — the device never carries the site's positional history (§5). Writes
// go through a persisted queue: audits happen in warehouses and comms rooms
// with no signal, so a confirmation must survive the app being backgrounded
// and killed on the walk back to a desk. The queue holds confirmations, which
// are small and are not history.

import { parsePositions, parseReconciliation, parseRoster } from './parse.js';
import type { Reconciliation } from './parse.js';
import type { Position, RosterEntry } from '../core/types.js';
import type { Sheet } from '../core/sheet.js';
import type { ShelfResult } from '../core/walk.js';

// What the auditor concluded about an asset nobody found. "Missed it" and
// "here but I could not read the note" are navigation, not conclusions: they
// send the auditor back to look, and what they find arrives as one of these.
export interface Decision {
  readonly asset: string;
  readonly decision: 'found' | 'removed';
}

const QUEUE_KEY = 'assetwalk.outbox';

interface Pending {
  readonly key: string;
  readonly path: string;
  readonly body: unknown;
}

export interface Backend {
  readonly base: string;
  // The auditor's own OAuth token, passed through to ServiceNow by the
  // backend. Null in SQLite deployments, which have no instance to talk to.
  readonly token: string | null;
}

function headers(backend: Backend, extra: Record<string, string>): Record<string, string> {
  return backend.token === null
    ? extra
    : { ...extra, authorization: `Bearer ${backend.token}` };
}

async function get(backend: Backend, path: string): Promise<unknown> {
  const response = await fetch(`${backend.base}${path}`, {
    headers: headers(backend, { accept: 'application/json' }),
    credentials: 'omit',
  });
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
  return response.json();
}

export async function fetchRoster(backend: Backend, walk: string): Promise<RosterEntry[]> {
  return parseRoster(await get(backend, `/walks/${encodeURIComponent(walk)}/roster`));
}

export async function fetchHistory(backend: Backend, location: string): Promise<Position[]> {
  return parsePositions(await get(backend, `/locations/${encodeURIComponent(location)}/history`));
}

export async function fetchReconciliation(
  backend: Backend,
  walk: string,
): Promise<Reconciliation> {
  return parseReconciliation(
    await get(backend, `/walks/${encodeURIComponent(walk)}/reconciliation`),
  );
}

// Called on shelf completion, immediately before the caller drops the history
// slice. The idempotency key is minted once and stored with the entry so a
// retry after an ambiguous timeout cannot double-apply the shelf.
//
// The wire shape is built here rather than sending the reducer's own object.
// /client/core owns the domain's names and /client/io owns the wire's, and
// keeping them separate is what lets either change without the other noticing.
export function queueShelf(result: ShelfResult): void {
  enqueue(`/walks/${encodeURIComponent(result.walk)}/shelves`, {
    walk: result.walk,
    location: result.location,
    confirmed: result.confirmed,
    unresolved: result.unresolved,
    new_devices: result.newDevices,
    unreadable: result.unreadable,
  });
}

export function queueSheets(location: string, sheets: readonly Sheet[]): void {
  enqueue(
    `/locations/${encodeURIComponent(location)}/sheets`,
    sheets.map((sheet) => ({
      id: sheet.id,
      walk: sheet.walk,
      location: sheet.location,
      printed_at: sheet.printedAt,
      members: sheet.members,
    })),
  );
}

export function queueDecisions(walk: string, decisions: readonly Decision[]): void {
  enqueue(`/walks/${encodeURIComponent(walk)}/reconciliation`, decisions);
}

function enqueue(path: string, body: unknown): void {
  write([...read(), { key: crypto.randomUUID(), path, body }]);
}

export function pendingCount(): number {
  return read().length;
}

// Sends queued entries oldest first, stopping at the first failure so ordering
// is preserved. Returns how many are still waiting.
export async function flush(backend: Backend): Promise<number> {
  let queue = read();
  while (queue.length > 0) {
    const entry = queue[0];
    if (entry === undefined) break;
    const response = await fetch(`${backend.base}${entry.path}`, {
      method: 'POST',
      headers: headers(backend, {
        'content-type': 'application/json',
        'idempotency-key': entry.key,
      }),
      credentials: 'omit',
      body: JSON.stringify(entry.body),
    });
    // A 5xx or a rejected fetch is worth retrying. A 4xx never will be, and
    // retrying it forever wedges every later shelf behind it — so drop it and
    // let reconciliation surface the gap. A stuck queue is silent; a shelf
    // missing from reconciliation is not.
    if (!response.ok && response.status >= 500) break;
    queue = queue.slice(1);
    write(queue);
  }
  return queue.length;
}

// Exponential backoff, capped. Runs until the queue drains; reconnect events
// call it again rather than polling on a timer.
export async function drain(backend: Backend, signal: AbortSignal): Promise<void> {
  let delay = 1000;
  while (pendingCount() > 0 && !signal.aborted) {
    const remaining = await flush(backend).catch(() => pendingCount());
    if (remaining === 0) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 60_000);
  }
}

// Storage is an external input like any other, even though this app wrote it:
// another tab, an older version of this code, or a browser extension can have
// been the last writer.
function read(): Pending[] {
  const raw = localStorage.getItem(QUEUE_KEY);
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { key, path, body } = entry as Record<string, unknown>;
    if (typeof key !== 'string' || typeof path !== 'string') return [];
    return [{ key, path, body }];
  });
}

function write(queue: readonly Pending[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}
