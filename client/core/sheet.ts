// Algorithm 2 — horizontal stacks, grouped by printed QR sheets.
//
// Laptops lie flat with their barcodes underneath, unreachable without
// disassembling the stack. Devices are only ever taken from the top, so a
// sheet slipped in at a substack boundary stays truthful about everything
// below it until someone reaches that depth — and when they do, the sheet
// leaves with the devices above it and the next walk prints a new one.
//
// The QR encodes the tags themselves, never a lookup ID. A group ID fails in
// exactly the situation the audit happens in: different auditor, different
// device, cleared cache, no signal. A self-contained sheet works offline
// forever.

import { digitsOf } from './types.js';
import type { AssetTag, LocationID, WalkID } from './types.js';

// 10–20 devices per substack. Fewer means printing and placing more sheets
// than the saved scans are worth. More widens the blast radius of a count
// mismatch, and the paper edge stops being reliably visible from the front of
// a deep stack — which is how the auditor finds the boundary at all.
export const SUBSTACK_MIN = 10;
export const SUBSTACK_MAX = 20;

// Payload is pure digits so the encoder can use QR numeric mode (3⅓ bits per
// digit against 5½ for alphanumeric). 40 tags × 7 digits ≈ 280 characters sits
// comfortably inside version 9 at ECC level M.
//
//   2 digits   format version
//   2 digits   digits per tag
//   3 digits   member count
//   n×w digits members, in stack order, top first, zero-padded
//   4 digits   checksum
//
// The site prefix (UniMelb's "UOM") is not carried: it is constant across the
// fleet, it costs 3 alphanumeric characters per tag, and it is printed on the
// sheet in human-readable form anyway.
const FORMAT = 1;
const CHECK_MOD = 10000;

export interface Sheet {
  readonly id: string;
  readonly walk: WalkID;
  readonly location: LocationID;
  readonly printedAt: string;
  // In stack order, top first. The sheet is placed directly above members[0].
  readonly members: readonly AssetTag[];
}

// Split one stack, top first, into substacks. Sizes are kept within one of
// each other rather than filling greedily to SUBSTACK_MAX: a short tail
// substack wastes a sheet and is the easiest one to miscount against its
// neighbours.
export function planSubstacks(stack: readonly AssetTag[]): AssetTag[][] {
  if (stack.length === 0) return [];
  const groups = Math.ceil(stack.length / SUBSTACK_MAX);
  const substacks: AssetTag[][] = [];
  let start = 0;
  for (let g = groups; g > 0; g--) {
    const size = Math.ceil((stack.length - start) / g);
    substacks.push(stack.slice(start, start + size));
    start += size;
  }
  return substacks;
}

export function encodeSheetPayload(members: readonly AssetTag[]): string {
  const digits = members.map(digitsOf);
  const width = Math.max(...digits.map((d) => d.length));
  const body =
    String(FORMAT).padStart(2, '0') +
    String(width).padStart(2, '0') +
    String(digits.length).padStart(3, '0') +
    digits.map((d) => d.padStart(width, '0')).join('');
  return body + String(checksum(body)).padStart(4, '0');
}

// Returns the member digit strings, or null if this is not an AssetWalk sheet
// payload. Decoding lives beside encoding so a reviewer can check the two
// halves of the format against each other in one screen.
export function decodeSheetPayload(payload: string): string[] | null {
  if (!/^[0-9]+$/.test(payload) || payload.length < 11) return null;

  const body = payload.slice(0, -4);
  if (checksum(body) !== Number(payload.slice(-4))) return null;
  if (Number(body.slice(0, 2)) !== FORMAT) return null;

  const width = Number(body.slice(2, 4));
  const count = Number(body.slice(4, 7));
  const tags = body.slice(7);
  if (width === 0 || tags.length !== width * count) return null;

  const members: string[] = [];
  for (let i = 0; i < count; i++) {
    members.push(digitsOf(tags.slice(i * width, (i + 1) * width)));
  }
  return members;
}

// Weighted so that transposing two digits changes the result; an unweighted
// sum would not notice, and two adjacent tags differing by a swap is a
// realistic way to mis-key a recovery entry.
function checksum(body: string): number {
  let total = 0;
  for (let i = 0; i < body.length; i++) {
    total = (total + (i + 1) * Number(body[i])) % CHECK_MOD;
  }
  return total;
}

// A scanned sheet yields digits; the walk holds full tags. Match on digits so
// the sheet stays independent of whatever prefix the site uses.
export function matchRoster(
  members: readonly string[],
  roster: Iterable<AssetTag>,
): Map<string, AssetTag> {
  const byDigits = new Map<string, AssetTag>();
  for (const tag of roster) byDigits.set(digitsOf(tag), tag);

  const matched = new Map<string, AssetTag>();
  for (const digits of members) {
    const tag = byDigits.get(digits);
    if (tag !== undefined) matched.set(digits, tag);
  }
  return matched;
}
