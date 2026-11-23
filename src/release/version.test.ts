import { describe, expect, it } from 'vitest';
import {
  bumpVersion,
  compareVersions,
  formatVersion,
  highestVersion,
  nextVersion,
  parseVersion,
} from './version.ts';
function describeParseVersionLenientInCanonicalOut() {
  function parsesAFullMAJORMINORPATCH() {
    const version = parseVersion('1.2.3');
    expect(version).toEqual({ major: 1, minor: 2, patch: 3 });
  }

  it('parses a full MAJOR.MINOR.PATCH', parsesAFullMAJORMINORPATCH);
  function defaultsMissingMinorPatchTo0() {
    const version = parseVersion('2');
    expect(version).toEqual({ major: 2, minor: 0, patch: 0 });
    expect(parseVersion('2.5')).toEqual({ major: 2, minor: 5, patch: 0 });
  }

  it('defaults missing minor/patch to 0', defaultsMissingMinorPatchTo0);
  function toleratesALeadingVWhitespaceAndAPrereleaseBuildSuffix() {
    const version = parseVersion('v1.2.3');
    expect(version).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion('  1.2.3  ')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion('1.2.3-beta.1')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion('1.2.3+exp.42')).toEqual({ major: 1, minor: 2, patch: 3 });
  }

  it(
    'tolerates a leading v, whitespace, and a prerelease/build suffix',
    toleratesALeadingVWhitespaceAndAPrereleaseBuildSuffix,
  );
  function rejectsNonVersionStringsAndOverLongCores() {
    const version = parseVersion('');
    expect(version).toBeNull();
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion('1.2.3.4')).toBeNull();
  }

  it('rejects non-version strings and over-long cores', rejectsNonVersionStringsAndOverLongCores);
}

describe('parseVersion - lenient in, canonical out', describeParseVersionLenientInCanonicalOut);
function describeBumpVersionNextVersionAdvanceOneComponentZeroTheRest() {
  function bumpsEachComponentAndResetsTheLowerOnes() {
    const v = { major: 1, minor: 4, patch: 2 };
    const version = bumpVersion(v, 'major');
    expect(formatVersion(version)).toBe('2.0.0');
    expect(formatVersion(bumpVersion(v, 'minor'))).toBe('1.5.0');
    expect(formatVersion(bumpVersion(v, 'patch'))).toBe('1.4.3');
  }

  it('bumps each component and resets the lower ones', bumpsEachComponentAndResetsTheLowerOnes);
  function nextVersionDrivesTheSuggestion100101() {
    expect(nextVersion('1.0.0', 'patch')).toBe('1.0.1');
    expect(nextVersion('1.0.0', 'minor')).toBe('1.1.0');
    expect(nextVersion('1.0.0', 'major')).toBe('2.0.0');
  }

  it('nextVersion drives the suggestion 1.0.0 -> 1.0.1', nextVersionDrivesTheSuggestion100101);
  function treatsAnUnparseableCurrentAs000InsteadOfThrowing() {
    expect(nextVersion('', 'patch')).toBe('0.0.1');
    expect(nextVersion('nope', 'minor')).toBe('0.1.0');
  }

  it(
    'treats an unparseable current as 0.0.0 instead of throwing',
    treatsAnUnparseableCurrentAs000InsteadOfThrowing,
  );
}

describe(
  'bumpVersion / nextVersion - advance one component, zero the rest',
  describeBumpVersionNextVersionAdvanceOneComponentZeroTheRest,
);
function describeCompareVersionsHighestVersionNumericNotLexical() {
  function ordersByNumericCore1100190TheLexicalTrap() {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
  }

  it(
    'orders by numeric core (1.10.0 > 1.9.0, the lexical trap)',
    ordersByNumericCore1100190TheLexicalTrap,
  );
  function picksTheHighestVersionPreservingItsOriginalForm() {
    expect(highestVersion(['1.0.0', '1.10.0', '1.9.0', '1.2.0'])).toBe('1.10.0');
    expect(highestVersion(['v2.0.0', '1.9.9'])).toBe('v2.0.0');
  }

  it(
    'picks the highest version, preserving its original form',
    picksTheHighestVersionPreservingItsOriginalForm,
  );
  function ignoresUnparseableEntriesAndReturnsNullWhenNoneParse() {
    expect(highestVersion(['garbage', '1.2.0', ''])).toBe('1.2.0');
    expect(highestVersion(['garbage', ''])).toBeNull();
    expect(highestVersion([])).toBeNull();
  }

  it(
    'ignores unparseable entries and returns null when none parse',
    ignoresUnparseableEntriesAndReturnsNullWhenNoneParse,
  );
}

describe(
  'compareVersions / highestVersion - numeric, not lexical',
  describeCompareVersionsHighestVersionNumericNotLexical,
);
