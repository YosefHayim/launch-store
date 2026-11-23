// The path carries the resource filter. `fields[...]`, `include`, and `sort` come from
// `defaultQuery` unless the caller sets the same key. A caller `null` drops that key.
// A collection `limit` is clamped to 0..200, and each `limit[resource]` to 50.
// https://developer.apple.com/documentation/appstoreconnectapi/paginginformation/paging-data.dictionary
// https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps

export interface AppleLimitBounds {
  min: number;
  max: number;
}

export const APPLE_PAGE_LIMIT: AppleLimitBounds = {
  min: 0,
  max: 200,
};

const APPLE_INCLUDED_LIMIT: AppleLimitBounds = {
  min: 0,
  max: 50,
};

export type AppleListQuery = Readonly<Record<string, string | number | null>>;

interface QueryPair {
  name: string;
  written: string;
}

function splitApplePath(path: string): { pathname: string; pairs: QueryPair[] } {
  const questionIndex = path.indexOf('?');

  if (questionIndex == -1) {
    return { pathname: path, pairs: [] };
  }

  const pathname = path.slice(0, questionIndex);
  const search = path.slice(questionIndex + 1);

  if (search == '') {
    return { pathname, pairs: [] };
  }

  const pairs: QueryPair[] = [];

  for (const piece of search.split('&')) {
    const equalsIndex = piece.indexOf('=');

    if (equalsIndex == -1) {
      pairs.push({ name: piece, written: '' });
      continue;
    }

    pairs.push({
      name: piece.slice(0, equalsIndex),
      written: piece.slice(equalsIndex + 1),
    });
  }

  return { pathname, pairs };
}

function clampCount(asked: number, bounds: AppleLimitBounds): number {
  const whole = Math.trunc(asked);

  if (whole < bounds.min) {
    return bounds.min;
  }

  if (whole > bounds.max) {
    return bounds.max;
  }

  return whole;
}

function boundsForQueryName(
  queryName: string,
  pageBounds: AppleLimitBounds,
): AppleLimitBounds | null {
  if (queryName == 'limit') {
    return pageBounds;
  }

  const isIncludedLimit = queryName.startsWith('limit[');

  if (isIncludedLimit) {
    return APPLE_INCLUDED_LIMIT;
  }

  return null;
}

function withQueryPair(
  pairs: readonly QueryPair[],
  queryName: string,
  written: string,
): QueryPair[] {
  const nextPairs = pairs.slice();
  const existingIndex = nextPairs.findIndex(function sameName(pair: QueryPair): boolean {
    return pair.name == queryName;
  });
  const isNewName = existingIndex == -1;

  if (isNewName) {
    nextPairs.push({ name: queryName, written });
    return nextPairs;
  }

  nextPairs[existingIndex] = { name: queryName, written };
  return nextPairs;
}

function dropQueryPair(pairs: readonly QueryPair[], queryName: string): QueryPair[] {
  function isOtherName(pair: QueryPair): boolean {
    return pair.name != queryName;
  }

  return pairs.filter(isOtherName);
}

function applyOneQuery(
  pairs: readonly QueryPair[],
  queryName: string,
  asked: string | number | null | undefined,
  replaceExisting: boolean,
): QueryPair[] {
  if (asked == null) {
    return dropQueryPair(pairs, queryName);
  }

  const written = String(asked);
  const alreadySet = pairs.some(function sameName(pair: QueryPair): boolean {
    return pair.name == queryName;
  });

  if (alreadySet == false) {
    return withQueryPair(pairs, queryName, written);
  }

  if (replaceExisting == false) {
    return pairs.slice();
  }

  return withQueryPair(pairs, queryName, written);
}

function applyNamedQuery(
  pairs: readonly QueryPair[],
  listQuery: AppleListQuery,
  replaceExisting: boolean,
): QueryPair[] {
  let nextPairs = pairs.slice();

  for (const queryName of Object.keys(listQuery)) {
    nextPairs = applyOneQuery(nextPairs, queryName, listQuery[queryName], replaceExisting);
  }

  return nextPairs;
}

function ensurePageLimit(pairs: readonly QueryPair[], pageBounds: AppleLimitBounds): QueryPair[] {
  const hasLimit = pairs.some(function isPageLimit(pair: QueryPair): boolean {
    return pair.name == 'limit';
  });

  if (hasLimit) {
    return pairs.slice();
  }

  return withQueryPair(pairs, 'limit', String(pageBounds.max));
}

function clampBoundedPair(pair: QueryPair, pageBounds: AppleLimitBounds): QueryPair {
  const bounds = boundsForQueryName(pair.name, pageBounds);

  if (bounds == null) {
    return pair;
  }

  const asked = Number(pair.written);
  const isNotACount = Number.isNaN(asked);

  if (isNotACount) {
    return pair;
  }

  const clamped = clampCount(asked, bounds);

  return { name: pair.name, written: String(clamped) };
}

function joinQuery(pathname: string, pairs: readonly QueryPair[]): string {
  if (pairs.length == 0) {
    return pathname;
  }

  function writePair(pair: QueryPair): string {
    return `${pair.name}=${pair.written}`;
  }

  const search = pairs.map(writePair).join('&');

  return `${pathname}?${search}`;
}

function joinAppleQuery(
  path: string,
  listQuery: AppleListQuery | null,
  defaultQuery: AppleListQuery | null,
  pageBounds: AppleLimitBounds | null,
): string {
  const splitPath = splitApplePath(path);
  let pairs = splitPath.pairs;

  if (defaultQuery != null) {
    pairs = applyNamedQuery(pairs, defaultQuery, false);
  }

  if (listQuery != null) {
    pairs = applyNamedQuery(pairs, listQuery, true);
  }

  if (pageBounds != null) {
    pairs = ensurePageLimit(pairs, pageBounds);
  }

  const bounds = pageBounds ?? APPLE_PAGE_LIMIT;

  function clampPair(pair: QueryPair): QueryPair {
    return clampBoundedPair(pair, bounds);
  }

  const clampedPairs = pairs.map(clampPair);

  return joinQuery(splitPath.pathname, clampedPairs);
}

export function applyAppleListQuery(
  path: string,
  listQuery: AppleListQuery | null,
  pageBounds: AppleLimitBounds,
  defaultQuery: AppleListQuery | null = null,
): string {
  return joinAppleQuery(path, listQuery, defaultQuery, pageBounds);
}

export function applyAppleReadQuery(
  path: string,
  listQuery: AppleListQuery | null = null,
  defaultQuery: AppleListQuery | null = null,
): string {
  return joinAppleQuery(path, listQuery, defaultQuery, null);
}
