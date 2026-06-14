/**
 * Pure marketing-version (semver) math, with no I/O.
 *
 * The "marketing version" is the human-facing `MAJOR.MINOR.PATCH` string (iOS
 * `CFBundleShortVersionString`, Android `versionName`, Expo's `expo.version`) — distinct from the
 * auto-incremented build number / versionCode. These helpers back the next-version suggestion
 * (`launch build` queries the store for the latest, then proposes a bump) and live here, free of
 * App Store Connect, fs, or prompt concerns, so the rules are trivially testable and reused by both
 * the ASC client (picking the highest existing version) and the pipeline (computing the suggestion).
 *
 * Parsing is deliberately lenient about inputs (`v1.2`, `1.2.3-beta`, `1`) because a real `app.json`
 * or a store record may carry any of them; output is always canonical `MAJOR.MINOR.PATCH`.
 */

/** Which component of a {@link SemVer} a bump advances (resetting the lower components to 0). */
export type VersionBump = "major" | "minor" | "patch";

/** A parsed marketing version. Pre-release / build metadata is dropped — only the numeric core is kept. */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parse a version string into its numeric core, or null when it has no usable `MAJOR[.MINOR[.PATCH]]`
 * shape. Tolerates a leading `v`, surrounding whitespace, and a `-prerelease`/`+build` suffix (which
 * is ignored); missing minor/patch default to 0. Non-string input (malformed store data) yields null.
 */
export function parseVersion(input: string): SemVer | null {
  if (typeof input !== "string") return null;
  const core = input.trim().replace(/^v/i, "").split(/[-+]/)[0] ?? "";
  if (!/^\d+(\.\d+){0,2}$/.test(core)) return null;
  const [major = 0, minor = 0, patch = 0] = core.split(".").map((part) => Number.parseInt(part, 10));
  return { major, minor, patch };
}

/** Render a {@link SemVer} back to the canonical `MAJOR.MINOR.PATCH` string. */
export function formatVersion(version: SemVer): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/** Advance one component, zeroing the lower ones (`1.4.2` →  major `2.0.0`, minor `1.5.0`, patch `1.4.3`). */
export function bumpVersion(version: SemVer, bump: VersionBump): SemVer {
  switch (bump) {
    case "major":
      return { major: version.major + 1, minor: 0, patch: 0 };
    case "minor":
      return { major: version.major, minor: version.minor + 1, patch: 0 };
    case "patch":
      return { major: version.major, minor: version.minor, patch: version.patch + 1 };
  }
}

/**
 * The next version string for a bump, starting from `current`. An unparseable `current` is treated as
 * `0.0.0`, so `nextVersion("", "patch")` is `"0.0.1"` rather than throwing.
 */
export function nextVersion(current: string, bump: VersionBump): string {
  const parsed = parseVersion(current) ?? { major: 0, minor: 0, patch: 0 };
  return formatVersion(bumpVersion(parsed, bump));
}

/**
 * Compare two versions by numeric core: `-1` if `a < b`, `1` if `a > b`, `0` if equal. Unparseable
 * inputs compare as `0.0.0` so a stray value never reorders real versions ahead of valid ones.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a) ?? { major: 0, minor: 0, patch: 0 };
  const right = parseVersion(b) ?? { major: 0, minor: 0, patch: 0 };
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return 0;
}

/**
 * The highest parseable version in a list, returned in its original form, or null when none parse.
 * Used to fold App Store + TestFlight versions into a single "latest on record" without trusting the
 * store's own (lexical) sort, which would order `1.10.0` below `1.9.0`.
 */
export function highestVersion(versions: string[]): string | null {
  const parseable = versions.filter((version) => parseVersion(version) !== null);
  if (parseable.length === 0) return null;
  return parseable.reduce((highest, version) => (compareVersions(version, highest) > 0 ? version : highest));
}
