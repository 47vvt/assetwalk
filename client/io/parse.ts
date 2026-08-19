// The validation boundary. Types are erased at runtime, so every value the
// backend sends is checked here, against the branded types in /client/core,
// before anything else in the app sees it. Failure throws by design: a changed
// backend schema must stop the walk loudly, not propagate `undefined` into the
// reducer and quietly corrupt an audit record.
//
// The small checkers below are shared with config.ts, which is the same job
// for the one file the deployment writes.

import { assetTag, locationID, walkID } from '../core/types.js';
import type { AssetTag, LocationID, Position, RosterEntry, WalkID } from '../core/types.js';

export class BoundaryError extends Error {}

function fail(path: string, value: unknown): never {
  throw new BoundaryError(`${path}: unexpected ${JSON.stringify(value) ?? typeof value}`);
}

export function field(record: unknown, path: string, key: string): unknown {
  if (typeof record !== 'object' || record === null) fail(path, record);
  return (record as Record<string, unknown>)[key];
}

export function str(record: unknown, path: string, key: string): string {
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

export interface Location {
  readonly id: LocationID;
  readonly orientation: 'vertical' | 'horizontal';
  readonly walked: boolean;
}

export interface Walk {
  readonly id: WalkID;
  readonly locations: readonly Location[];
}

function orientation(record: unknown, path: string): 'vertical' | 'horizontal' {
  const value = str(record, path, 'orientation');
  // Not decoration: it decides whether this shelf is walked by sticky note or
  // by printed QR sheet, so an unrecognised value must not silently become one.
  if (value === 'vertical' || value === 'horizontal') return value;
  return fail(`${path}.orientation`, value);
}

function location(entry: unknown, path: string): Location {
  const walked = field(entry, path, 'walked');
  return {
    id: place(entry, path, 'id'),
    orientation: orientation(entry, path),
    walked: walked === true,
  };
}

export function parseLocations(raw: unknown): Location[] {
  return list(raw, 'locations').map((entry, i) => location(entry, `locations[${i}]`));
}

export function parseWalks(raw: unknown): Walk[] {
  return list(raw, 'walks').map((entry, i) => ({
    id: walkID(str(entry, `walks[${i}]`, 'id')) ?? fail(`walks[${i}].id`, entry),
    locations: list(field(entry, `walks[${i}]`, 'locations'), `walks[${i}].locations`).map(
      (covered, j) => location(covered, `walks[${i}].locations[${j}]`),
    ),
  }));
}
