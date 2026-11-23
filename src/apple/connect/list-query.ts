// The path carries filters and fields. This writes `limit`, clamped to the documented range:
// a collection limit is 0 to 200, and each `limit[resource]` is 50.
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

export type AppleListQuery = Readonly<Record<string, string | number>>;

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

function applyCallerQuery(pairs: readonly QueryPair[], listQuery: AppleListQuery): QueryPair[] {
  let nextPairs = pairs.slice();

  for (const queryName of Object.keys(listQuery)) {
    const written = String(listQuery[queryName]);
    nextPairs = withQueryPair(nextPairs, queryName, written);
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

export function applyAppleListQuery(
  path: string,
  listQuery: AppleListQuery | null,
  pageBounds: AppleLimitBounds,
): string {
  const splitPath = splitApplePath(path);
  let pairs = splitPath.pairs;

  if (listQuery != null) {
    pairs = applyCallerQuery(pairs, listQuery);
  }

  pairs = ensurePageLimit(pairs, pageBounds);

  function clampPair(pair: QueryPair): QueryPair {
    return clampBoundedPair(pair, pageBounds);
  }

  const clampedPairs = pairs.map(clampPair);

  return joinQuery(splitPath.pathname, clampedPairs);
}
