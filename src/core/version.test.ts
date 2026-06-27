import { describe, expect, it } from 'vitest';
import {
  bumpVersion,
  compareVersions,
  formatVersion,
  highestVersion,
  nextVersion,
  parseVersion,
} from './version.js';

describe('parseVersion — lenient in, canonical out', () => {
  it('parses a full MAJOR.MINOR.PATCH', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('defaults missing minor/patch to 0', () => {
    expect(parseVersion('2')).toEqual({ major: 2, minor: 0, patch: 0 });
    expect(parseVersion('2.5')).toEqual({ major: 2, minor: 5, patch: 0 });
  });

  it('tolerates a leading v, whitespace, and a prerelease/build suffix', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion('  1.2.3  ')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion('1.2.3-beta.1')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion('1.2.3+exp.42')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('rejects non-version strings and over-long cores', () => {
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion('1.2.3.4')).toBeNull();
    // Defensive against malformed store data typed as string.
    expect(parseVersion(undefined as unknown as string)).toBeNull();
  });
});

describe('bumpVersion / nextVersion — advance one component, zero the rest', () => {
  it('bumps each component and resets the lower ones', () => {
    const v = { major: 1, minor: 4, patch: 2 };
    expect(formatVersion(bumpVersion(v, 'major'))).toBe('2.0.0');
    expect(formatVersion(bumpVersion(v, 'minor'))).toBe('1.5.0');
    expect(formatVersion(bumpVersion(v, 'patch'))).toBe('1.4.3');
  });

  it('nextVersion drives the suggestion 1.0.0 → 1.0.1', () => {
    expect(nextVersion('1.0.0', 'patch')).toBe('1.0.1');
    expect(nextVersion('1.0.0', 'minor')).toBe('1.1.0');
    expect(nextVersion('1.0.0', 'major')).toBe('2.0.0');
  });

  it('treats an unparseable current as 0.0.0 instead of throwing', () => {
    expect(nextVersion('', 'patch')).toBe('0.0.1');
    expect(nextVersion('nope', 'minor')).toBe('0.1.0');
  });
});

describe('compareVersions / highestVersion — numeric, not lexical', () => {
  it('orders by numeric core (1.10.0 > 1.9.0, the lexical trap)', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
  });

  it('picks the highest version, preserving its original form', () => {
    expect(highestVersion(['1.0.0', '1.10.0', '1.9.0', '1.2.0'])).toBe('1.10.0');
    expect(highestVersion(['v2.0.0', '1.9.9'])).toBe('v2.0.0');
  });

  it('ignores unparseable entries and returns null when none parse', () => {
    expect(highestVersion(['garbage', '1.2.0', ''])).toBe('1.2.0');
    expect(highestVersion(['garbage', ''])).toBeNull();
    expect(highestVersion([])).toBeNull();
  });
});
