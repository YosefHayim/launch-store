import { describe, expect, it } from 'vitest';
import { buildRelease, isReleaseStatus, parseReleaseNotes, parseRollout } from './play-tracks.ts';
function describeIsReleaseStatus() {
  function recognizesPlaySStatusesAndRejectsOthers() {
    expect(isReleaseStatus('inProgress')).toBe(true);
    expect(isReleaseStatus('completed')).toBe(true);
    expect(isReleaseStatus('live')).toBe(false);
  }

  it("recognizes Play's statuses and rejects others", recognizesPlaySStatusesAndRejectsOthers);
}

describe('isReleaseStatus', describeIsReleaseStatus);
function describeParseRollout() {
  function acceptsAFractionStrictlyBetween0And1() {
    const rollout = parseRollout('0.1');
    expect(rollout).toBe(0.1);
    expect(parseRollout('0.999')).toBe(0.999);
  }

  it('accepts a fraction strictly between 0 and 1', acceptsAFractionStrictlyBetween0And1);
  function rejects01OutOfRangeAndNonNumericValues() {
    function callParseRollout() {
      return parseRollout('0');
    }

    expect(callParseRollout).toThrow(/between 0 and 1/);
    function callParseRollout2() {
      return parseRollout('1');
    }

    expect(callParseRollout2).toThrow(/between 0 and 1/);
    function callParseRollout3() {
      return parseRollout('1.5');
    }

    expect(callParseRollout3).toThrow(/between 0 and 1/);
    function callParseRollout4() {
      return parseRollout('soon');
    }

    expect(callParseRollout4).toThrow(/between 0 and 1/);
  }

  it('rejects 0, 1, out-of-range, and non-numeric values', rejects01OutOfRangeAndNonNumericValues);
}

describe('parseRollout', describeParseRollout);
function describeParseReleaseNotes() {
  function turnsALanguageToPieceObjectIntoTheAPISArrayShape() {
    const releaseNotes = parseReleaseNotes({ 'en-US': 'Bug fixes', 'de-DE': 'Fehlerbehebungen' });
    expect(releaseNotes).toEqual([
      { language: 'en-US', text: 'Bug fixes' },
      { language: 'de-DE', text: 'Fehlerbehebungen' },
    ]);
  }

  it(
    "turns a language-to-text object into the API's array shape",
    turnsALanguageToPieceObjectIntoTheAPISArrayShape,
  );
  function rejectsNonObjectDocumentsAndNonStringNotes() {
    function callParseReleaseNotes() {
      return parseReleaseNotes(['en-US', 'Bug fixes']);
    }

    expect(callParseReleaseNotes).toThrow(/must be a JSON object/);
    function callParseReleaseNotes2() {
      return parseReleaseNotes('Bug fixes');
    }

    expect(callParseReleaseNotes2).toThrow(/must be a JSON object/);
    function callParseReleaseNotes3() {
      return parseReleaseNotes({ 'en-US': 5 });
    }

    expect(callParseReleaseNotes3).toThrow(/must be a JSON object/);
  }

  it(
    'rejects non-object documents and non-string notes',
    rejectsNonObjectDocumentsAndNonStringNotes,
  );
}

describe('parseReleaseNotes', describeParseReleaseNotes);
function describeBuildRelease() {
  function buildsACompletedFullRolloutReleaseWithNotes() {
    expect(
      buildRelease({
        versionCodes: ['12'],
        status: 'completed',
        releaseNotes: [{ language: 'en-US', text: 'Bug fixes' }],
      }),
    ).toEqual({
      status: 'completed',
      versionCodes: ['12'],
      releaseNotes: [{ language: 'en-US', text: 'Bug fixes' }],
    });
  }

  it(
    'builds a completed full-rollout release with notes',
    buildsACompletedFullRolloutReleaseWithNotes,
  );
  function buildsAnInProgressStagedRolloutWithItsFraction() {
    expect(buildRelease({ versionCodes: ['12'], status: 'inProgress', userFraction: 0.1 })).toEqual(
      {
        status: 'inProgress',
        versionCodes: ['12'],
        userFraction: 0.1,
      },
    );
  }

  it(
    'builds an in-progress staged rollout with its fraction',
    buildsAnInProgressStagedRolloutWithItsFraction,
  );
  function requiresAFractionForInProgressAndForbidsOneForCompletedDraft() {
    function callBuildRelease() {
      return buildRelease({ versionCodes: ['12'], status: 'inProgress' });
    }

    expect(callBuildRelease).toThrow(/needs a rollout fraction/);
    function callBuildRelease2() {
      return buildRelease({ versionCodes: ['12'], status: 'completed', userFraction: 0.5 });
    }

    expect(callBuildRelease2).toThrow(/can't carry a rollout fraction/);
  }

  it(
    'requires a fraction for inProgress and forbids one for completed/draft',
    requiresAFractionForInProgressAndForbidsOneForCompletedDraft,
  );
  function rejectsAnEmptyVersionListAndAnOutOfRangeFraction() {
    function callBuildRelease3() {
      return buildRelease({ versionCodes: [], status: 'completed' });
    }

    expect(callBuildRelease3).toThrow(/at least one version code/);
    function callBuildRelease4() {
      return buildRelease({ versionCodes: ['12'], status: 'inProgress', userFraction: 1 });
    }

    expect(callBuildRelease4).toThrow(/between 0 and 1/);
  }

  it(
    'rejects an empty version list and an out-of-range fraction',
    rejectsAnEmptyVersionListAndAnOutOfRangeFraction,
  );
}

describe('buildRelease', describeBuildRelease);
