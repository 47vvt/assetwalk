// Domain vocabulary. Every name here is the physical act or object, not the
// data operation — that is what keeps the reducer readable at 2am in a comms
// room. Nothing in /client/core knows that ServiceNow exists.

// Branded strings. Erased at runtime; they exist so a LocationID can never be
// passed where an AssetTag is expected. The only place a brand is minted is
// the smart constructor below, so a reviewer has exactly one line to check.
export type AssetTag = string & { readonly __brand: 'AssetTag' };
export type LocationID = string & { readonly __brand: 'LocationID' };
export type WalkID = string & { readonly __brand: 'WalkID' };

// Asset tags are an optional short alphabetic site prefix followed by digits
// (UniMelb's are UOM + 6 digits). Anything else is a mis-scan or a typo and
// must not reach the reducer.
const TAG_SHAPE = /^[A-Za-z]{0,4}[0-9]{4,10}$/;
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export function assetTag(raw: string): AssetTag | null {
  const trimmed = raw.trim().toUpperCase();
  return TAG_SHAPE.test(trimmed) ? (trimmed as AssetTag) : null;
}

export function locationID(raw: string): LocationID | null {
  return ID_SHAPE.test(raw) ? (raw as LocationID) : null;
}

export function walkID(raw: string): WalkID | null {
  return ID_SHAPE.test(raw) ? (raw as WalkID) : null;
}

// The digits of a tag, leading zeros stripped. Handwritten sticky notes lose
// leading characters to wear and QR sheet payloads carry digits only, so
// digits are the identity people and scanners actually agree on.
export function digitsOf(tag: string): string {
  const digits = tag.replace(/[^0-9]/g, '');
  return digits.replace(/^0+(?=[0-9])/, '');
}

// The shape every tag in one walk shares: an alphabetic site prefix and a
// number of digits after it.
export interface TagShape {
  readonly prefix: string;
  readonly digits: number;
}

// A fleet's tags all carry the same prefix — that is what made it worth
// printing faintly in the first place — so it is a label to read, not something
// to type. Derived from the walk's own tags rather than configured: hard-coding
// "UOM" here would put one site's labelling convention in the domain core.
export function tagShape(tags: Iterable<string>): TagShape {
  let prefix: string | null = null;
  let digits = 0;
  for (const tag of tags) {
    const head = tag.replace(/[0-9].*$/, '');
    prefix = prefix === null ? head : shared(prefix, head);
    digits = Math.max(digits, tag.length - head.length);
  }
  // A walk that carries no tags at all has nothing to learn from, and the only
  // thing the auditor can do is record a device nobody expected. Six digits is
  // what the shortest legal tag plus room to grow looks like.
  return { prefix: prefix ?? '', digits: digits === 0 ? 6 : digits };
}

function shared(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
}

// A slot in a shelf's history: this asset was at this sequence in this
// location as of the last walk.
export interface Position {
  readonly location: LocationID;
  readonly sequence: number;
  readonly asset: AssetTag;
}

// An asset the audit expects to find somewhere in this walk. `location` is
// where it was last seen, which is a hint for reconciliation and nothing more.
export interface RosterEntry {
  readonly asset: AssetTag;
  readonly location: LocationID | null;
}
