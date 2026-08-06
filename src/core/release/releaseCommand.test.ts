import { describe, expect, it } from 'vitest';
import type { BuildResource } from '../types/appleCatalog.js';
import type { ReleaseAction, ReleaseReport } from './appStoreRelease.js';
import {
  countFailedReleaseActions,
  formatReleaseActionLine,
  isVerifiedStoreBuild,
  makeReleaseCommandFailure,
  newestValidBuild,
  parseAppStoreBuildSelector,
  resolveAndroidRollout,
  shouldNudgeRelease,
} from './releaseCommand.js';

const storeBuild = (overrides: Partial<BuildResource> = {}): BuildResource => ({
  id: 'b-1',
  version: '42',
  processingState: 'VALID',
  expired: false,
  ...overrides,
});

const releaseAction = (overrides: Partial<ReleaseAction> = {}): ReleaseAction => ({
  description: 'attach build 42',
  status: 'applied',
  ...overrides,
});

const releaseReport = (actions: ReleaseAction[]): ReleaseReport => ({
  bundleId: 'com.acme.app',
  versionId: 'v-1',
  versionString: '1.2.0',
  appStoreState: 'WAITING_FOR_REVIEW',
  submitted: true,
  alreadyInReview: false,
  actions,
});

describe('shouldNudgeRelease - second confirm only for incremental artifacts', () => {
  it('does not nudge a clean (from-scratch) artifact', () => {
    expect(shouldNudgeRelease({ clean: true })).toBe(false);
  });

  it('nudges an incrementally-built artifact before public release', () => {
    expect(shouldNudgeRelease({ clean: false })).toBe(true);
  });
});

describe('isVerifiedStoreBuild / newestValidBuild', () => {
  it('accepts only processed, non-expired builds', () => {
    expect(isVerifiedStoreBuild(storeBuild())).toBe(true);
    expect(isVerifiedStoreBuild(storeBuild({ processingState: 'PROCESSING' }))).toBe(false);
    expect(isVerifiedStoreBuild(storeBuild({ expired: true }))).toBe(false);
  });

  it('returns the first verified build in list order', () => {
    const builds = [
      storeBuild({ id: 'processing', processingState: 'PROCESSING', version: '40' }),
      storeBuild({ id: 'expired', expired: true, version: '41' }),
      storeBuild({ id: 'valid', version: '42' }),
      storeBuild({ id: 'also-valid', version: '43' }),
    ];
    expect(newestValidBuild(builds)?.id).toBe('valid');
  });

  it('returns null when nothing is promotable', () => {
    expect(newestValidBuild([storeBuild({ processingState: 'FAILED' })])).toBeNull();
    expect(newestValidBuild([])).toBeNull();
  });
});

describe('parseAppStoreBuildSelector', () => {
  it('parses latest and numeric selectors', () => {
    expect(parseAppStoreBuildSelector('latest')).toEqual({ kind: 'latest' });
    expect(parseAppStoreBuildSelector('42')).toEqual({ kind: 'number', buildNumber: 42 });
  });

  it('rejects non-numeric selectors that are not latest', () => {
    expect(parseAppStoreBuildSelector('main')).toEqual({ kind: 'invalid', selector: 'main' });
    expect(parseAppStoreBuildSelector('')).toEqual({ kind: 'invalid', selector: '' });
  });
});

describe('resolveAndroidRollout', () => {
  it('prefers the CLI flag over the profile default', () => {
    expect(resolveAndroidRollout(0.25, '0.5')).toBe(0.5);
  });

  it('uses the profile fraction when no flag is passed', () => {
    expect(resolveAndroidRollout(0.1, undefined)).toBe(0.1);
  });

  it('defaults to a full production rollout', () => {
    expect(resolveAndroidRollout(undefined, undefined)).toBe(1);
  });
});

describe('formatReleaseActionLine / countFailedReleaseActions', () => {
  it('renders plan lines with skipped notes', () => {
    expect(
      formatReleaseActionLine(
        releaseAction({ status: 'skipped', note: 'already attached' }),
        'plan',
      ),
    ).toBe('- attach build 42 (already attached)');
  });

  it('renders receipt failures with an error suffix', () => {
    expect(
      formatReleaseActionLine(releaseAction({ status: 'failed', error: 'ASC 409' }), 'receipt'),
    ).toBe('x attach build 42 - ASC 409');
  });

  it('counts only failed steps for the exit code', () => {
    expect(
      countFailedReleaseActions(
        releaseReport([
          releaseAction({ status: 'applied' }),
          releaseAction({ status: 'failed' }),
          releaseAction({ status: 'skipped' }),
          releaseAction({ status: 'failed' }),
        ]),
      ),
    ).toBe(2);
    expect(countFailedReleaseActions(releaseReport([]))).toBe(0);
  });
});

describe('makeReleaseCommandFailure', () => {
  it('tags command failures for the Effect channel', () => {
    const failure = makeReleaseCommandFailure({
      operation: 'upload App Store build',
      message: 'network down',
      cause: new Error('network down'),
    });
    expect(failure._tag).toBe('ReleaseCommandFailure');
    expect(failure.operation).toBe('upload App Store build');
    expect(failure.message).toBe('network down');
  });
});
