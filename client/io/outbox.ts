// The confirmations waiting to be sent.
//
// Audits happen in warehouses and comms rooms with no signal, so a shelf's
// confirmations must survive the app being backgrounded and killed on the walk
// back to a desk. This is the only thing the app writes to the device, and it
// is deliberately not history: a confirmation is a handful of tags the auditor
// has already seen, where a shelf's recorded order is the site's inventory
// (§5). That is why reads are held in memory and only writes are persisted.

import type { Sheet } from '../core/sheet.js';
import type { ShelfResult } from '../core/walk.js';
import { request } from './server.js';
import type { Backend } from './server.js';

const QUEUE_KEY = 'assetwalk.outbox';

interface Pending {
  readonly key: string;
  readonly path: string;
  readonly body: unknown;
}

// Called on shelf completion, immediately before the caller drops the history
// slice. The idempotency key is minted once and stored with the entry, so a
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

export function pendingCount(): number {
  return read().length;
}

// Sends queued entries oldest first, stopping at the first failure so ordering
// is preserved, then backs off and tries again until the queue drains.
// Reconnecting calls this again rather than polling on a timer.
export async function drain(backend: Backend, signal: AbortSignal): Promise<void> {
  let delay = 1000;
  while (pendingCount() > 0 && !signal.aborted) {
    const remaining = await flush(backend).catch(() => pendingCount());
    if (remaining === 0) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 60_000);
  }
}

// Returns how many entries are still waiting.
async function flush(backend: Backend): Promise<number> {
  let queue = read();
  while (queue.length > 0) {
    const entry = queue[0];
    if (entry === undefined) break;
    const response = await request(backend, {
      method: 'POST',
      path: entry.path,
      body: entry.body,
      idempotencyKey: entry.key,
    });
    // A 5xx or a rejected fetch is worth retrying. A 4xx never will be, and
    // retrying it forever wedges every later shelf behind it — so drop it and
    // let reconciliation surface the gap. A stuck queue is silent; a shelf
    // missing from reconciliation is not.
    if (response.status >= 500) break;
    queue = queue.slice(1);
    write(queue);
  }
  return queue.length;
}

function enqueue(path: string, body: unknown): void {
  write([...read(), { key: crypto.randomUUID(), path, body }]);
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
