// A fixture, not configuration. It exists so the client demonstrates both
// algorithms in a plain browser with no backend and no ServiceNow instance —
// which is what a reviewer opens first and what gets demoed.
//
// The shelf below is deliberately mutated against its history: one device
// removed from the middle, one swapped with its neighbour, one brand new.

import { assetTag, locationID, walkID } from './core/types.js';
import type { AssetTag, LocationID, Position, WalkID } from './core/types.js';

function tag(raw: string): AssetTag {
  const parsed = assetTag(raw);
  if (parsed === null) throw new Error(`fixture tag is malformed: ${raw}`);
  return parsed;
}

export const DEMO_WALK: WalkID = walkID('demo-walk') ?? never();
export const DEMO_LOCATION: LocationID = locationID('BAY-A3') ?? never();

const SHELF = [
  'UOM123456',
  'UOM270313',
  'UOM420696',
  'UOM400699',
  'UOM220126',
  'UOM724528',
  'UOM118820',
  'UOM905517',
].map(tag);

export const DEMO_HISTORY: readonly Position[] = SHELF.map((asset, i) => ({
  location: DEMO_LOCATION,
  sequence: i,
  asset,
}));

// Wider than this shelf: a roster spans the whole walk, which is how a device
// relocated from another bay resolves at step 3 of the lookup.
export const DEMO_ROSTER: ReadonlySet<AssetTag> = new Set(
  [...SHELF, tag('UOM551204'), tag('UOM669001')],
);

function never(): never {
  throw new Error('fixture identifiers are malformed');
}
