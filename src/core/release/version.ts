export type VersionBump = 'major' | 'minor' | 'patch';
/**
 * A user-facing version-bump choice: a semver {@link VersionBump} or `"keep"` (reuse the current version).
 * This is the rememberable set - the kind persisted as a build's last pick (see `core/lastRun.ts`) and the
 * accepted values of `launch build --bump` (alongside the CLI-only `"ask"`, which forces the prompt). A
 * "Custom..." typed version has no kind, so it's never remembered.
 */
export type BumpKind = VersionBump | 'keep';
/** A parsed marketing version. Pre-release / build metadata is dropped - only the numeric core is kept. */
export type SemVer = {
  major: number;
  minor: number;
  patch: number;
};
const ZERO_VERSION: SemVer = { major: 0, minor: 0, patch: 0 };
/**
 * Parse a version string into its numeric core, or null when it has no usable `MAJOR[.MINOR[.PATCH]]`
 * shape. Tolerates a leading `v`, surrounding whitespace, and a `-prerelease`/`+build` suffix (which
 * is ignored); missing minor/patch default to 0. Non-string input (malformed store data) yields null.
 */
export const parseVersion = (input: string): SemVer | null => {
  const versionParts = input.trim().replace(/^v/i, '').split(/[-+]/);
  let core = versionParts[0];
  if (core === undefined) core = '';
  if (!/^\d+(\.\d+){0,2}$/.test(core)) return null;
  const [major = 0, minor = 0, patch = 0] = core
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  return { major, minor, patch };
};
/** Render a {@link SemVer} back to the canonical `MAJOR.MINOR.PATCH` string. */
export const formatVersion = (version: SemVer): string => {
  return `${version.major}.${version.minor}.${version.patch}`;
};
/** Advance one component, zeroing the lower ones (`1.4.2` ->  major `2.0.0`, minor `1.5.0`, patch `1.4.3`). */
export const bumpVersion = (version: SemVer, bump: VersionBump): SemVer => {
  switch (bump) {
    case 'major':
      return { major: version.major + 1, minor: 0, patch: 0 };
    case 'minor':
      return { major: version.major, minor: version.minor + 1, patch: 0 };
    case 'patch':
      return { major: version.major, minor: version.minor, patch: version.patch + 1 };
  }
};
/**
 * The next version string for a bump, starting from `current`. An unparseable `current` is treated as
 * `0.0.0`, so `nextVersion("", "patch")` is `"0.0.1"` rather than throwing.
 */
export const nextVersion = (current: string, bump: VersionBump): string => {
  let parsed = parseVersion(current);
  if (parsed === null) parsed = ZERO_VERSION;
  return formatVersion(bumpVersion(parsed, bump));
};
/**
 * Compare two versions by numeric core: `-1` if `a < b`, `1` if `a > b`, `0` if equal. Unparseable
 * inputs compare as `0.0.0` so a stray value never reorders real versions ahead of valid ones.
 */
export const compareVersions = (a: string, b: string): number => {
  let left = parseVersion(a);
  if (left === null) left = ZERO_VERSION;
  let right = parseVersion(b);
  if (right === null) right = ZERO_VERSION;
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] < right[key]) return -1;
    if (left[key] > right[key]) return 1;
  }
  return 0;
};
/**
 * The highest parseable version in a list, returned in its original form, or null when none parse.
 * Used to fold App Store + TestFlight versions into a single "latest on record" without trusting the
 * store's own (lexical) sort, which would order `1.10.0` below `1.9.0`.
 */
export const highestVersion = (versions: string[]): string | null => {
  const parseable = versions.filter((version) => parseVersion(version) !== null);
  if (parseable.length === 0) return null;
  return parseable.reduce((highest, version) => {
    if (compareVersions(version, highest) > 0) return version;
    return highest;
  });
};
