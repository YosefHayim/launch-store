import { describe, expect, it } from 'vitest';
import type {
  BetaAppReviewSubmissionResource,
  BetaBuildLocalizationResource,
  BuildResource,
} from '../apple/ascClient.js';
import {
  type AscBetaReviewApi,
  parseBetaReviewConfig,
  reconcileBetaReview,
  summarizeBetaReview,
} from './betaReview.js';

/** Records every write the reconciler makes, so a test can assert what was (and wasn't) sent. */
interface Calls {
  created: { buildId: string; locale: string; whatsNew: string }[];
  updated: { id: string; whatsNew: string }[];
  submitted: string[];
}

/** State the fake API serves on reads — what App Store Connect already has. */
interface State {
  builds: BuildResource[];
  localizations: BetaBuildLocalizationResource[];
  submission: BetaAppReviewSubmissionResource | null;
}

const BUILD: BuildResource = {
  id: 'build-1',
  version: '42',
  processingState: 'VALID',
  expired: false,
};

/** A hand-rolled {@link AscBetaReviewApi} — no network — returning `state` and recording writes in `calls`. */
function makeApi(state: Partial<State>): { api: AscBetaReviewApi; calls: Calls } {
  const full: State = { builds: [BUILD], localizations: [], submission: null, ...state };
  const calls: Calls = { created: [], updated: [], submitted: [] };
  const api: AscBetaReviewApi = {
    listBuilds: () => Promise.resolve(full.builds),
    listBetaBuildLocalizations: () => Promise.resolve(full.localizations),
    createBetaBuildLocalization: (buildId, locale, whatsNew) => {
      calls.created.push({ buildId, locale, whatsNew });
      return Promise.resolve();
    },
    updateBetaBuildLocalization: (id, whatsNew) => {
      calls.updated.push({ id, whatsNew });
      return Promise.resolve();
    },
    getBetaAppReviewSubmission: () => Promise.resolve(full.submission),
    createBetaAppReviewSubmission: (buildId) => {
      calls.submitted.push(buildId);
      return Promise.resolve();
    },
  };
  return { api, calls };
}

const WHATS_NEW = { 'en-US': 'Bug fixes.' };

describe('parseBetaReviewConfig', () => {
  it('parses a whatToTest map', () => {
    expect(parseBetaReviewConfig({ whatToTest: WHATS_NEW })).toEqual({ whatToTest: WHATS_NEW });
  });

  it('rejects a non-object, a missing/empty map, and a non-string note', () => {
    expect(() => parseBetaReviewConfig('nope')).toThrow(/must be a JSON object/);
    expect(() => parseBetaReviewConfig({})).toThrow(/"whatToTest" must be an object/);
    expect(() => parseBetaReviewConfig({ whatToTest: {} })).toThrow(/at least one locale/);
    expect(() => parseBetaReviewConfig({ whatToTest: { 'en-US': '' } })).toThrow(
      /must be a non-empty string/,
    );
  });
});

describe('reconcileBetaReview', () => {
  it('sets a new What-to-Test note and submits for review (apply)', async () => {
    const { api, calls } = makeApi({});
    const report = await reconcileBetaReview(api, {
      appId: 'app-1',
      whatToTest: WHATS_NEW,
      submitForReview: true,
      dryRun: false,
    });
    expect(report.buildVersion).toBe('42');
    expect(calls.created).toEqual([
      { buildId: 'build-1', locale: 'en-US', whatsNew: 'Bug fixes.' },
    ]);
    expect(calls.submitted).toEqual(['build-1']);
    expect(summarizeBetaReview(report.actions)).toEqual({ applied: 2, failed: 0, skipped: 0 });
  });

  it('updates an existing note when the text differs, and leaves an identical one alone', async () => {
    const { api, calls } = makeApi({
      localizations: [{ id: 'loc-1', locale: 'en-US', whatsNew: 'Old notes.' }],
    });
    await reconcileBetaReview(api, {
      appId: 'app-1',
      whatToTest: WHATS_NEW,
      submitForReview: false,
      dryRun: false,
    });
    expect(calls.created).toHaveLength(0);
    expect(calls.updated).toEqual([{ id: 'loc-1', whatsNew: 'Bug fixes.' }]);

    const { api: api2, calls: calls2 } = makeApi({
      localizations: [{ id: 'loc-1', locale: 'en-US', whatsNew: 'Bug fixes.' }],
    });
    const report = await reconcileBetaReview(api2, {
      appId: 'app-1',
      whatToTest: WHATS_NEW,
      submitForReview: false,
      dryRun: false,
    });
    expect(calls2.updated).toHaveLength(0); // identical → no-op
    expect(report.actions).toHaveLength(0);
  });

  it('skips submission (reporting the state) when the build was already submitted', async () => {
    const { api, calls } = makeApi({ submission: { id: 'sub-1', state: 'IN_REVIEW' } });
    const report = await reconcileBetaReview(api, {
      appId: 'app-1',
      whatToTest: {},
      submitForReview: true,
      dryRun: false,
    });
    expect(calls.submitted).toHaveLength(0);
    expect(summarizeBetaReview(report.actions)).toEqual({ applied: 0, failed: 0, skipped: 1 });
    expect(report.actions[0]?.description).toContain('in review');
  });

  it('targets a specific build by version, and rejects an expired or missing one', async () => {
    const builds: BuildResource[] = [
      { id: 'build-2', version: '43', processingState: 'VALID', expired: false },
      { id: 'build-1', version: '42', processingState: 'VALID', expired: true },
    ];
    const { api, calls } = makeApi({ builds });
    const report = await reconcileBetaReview(api, {
      appId: 'app-1',
      buildVersion: '43',
      whatToTest: WHATS_NEW,
      submitForReview: false,
      dryRun: false,
    });
    expect(report.buildVersion).toBe('43');
    expect(calls.created).toEqual([
      { buildId: 'build-2', locale: 'en-US', whatsNew: 'Bug fixes.' },
    ]);

    await expect(
      reconcileBetaReview(api, {
        appId: 'app-1',
        buildVersion: '42',
        whatToTest: {},
        submitForReview: false,
        dryRun: false,
      }),
    ).rejects.toThrow(/expired/);
    await expect(
      reconcileBetaReview(api, {
        appId: 'app-1',
        buildVersion: '99',
        whatToTest: {},
        submitForReview: false,
        dryRun: false,
      }),
    ).rejects.toThrow(/No build 99/);
  });

  it('picks the newest VALID, non-expired build when no version is given', async () => {
    const builds: BuildResource[] = [
      { id: 'processing', version: '44', processingState: 'PROCESSING', expired: false },
      { id: 'good', version: '43', processingState: 'VALID', expired: false },
      { id: 'old', version: '42', processingState: 'VALID', expired: false },
    ];
    const { api } = makeApi({ builds });
    const report = await reconcileBetaReview(api, {
      appId: 'app-1',
      whatToTest: {},
      submitForReview: false,
      dryRun: false,
    });
    expect(report.buildVersion).toBe('43');
  });

  it("throws when there's no eligible build", async () => {
    const { api } = makeApi({
      builds: [{ id: 'p', version: '1', processingState: 'PROCESSING', expired: false }],
    });
    await expect(
      reconcileBetaReview(api, {
        appId: 'app-1',
        whatToTest: {},
        submitForReview: true,
        dryRun: false,
      }),
    ).rejects.toThrow(/No VALID, non-expired build/);
  });

  it('plans but performs nothing on a dry-run', async () => {
    const { api, calls } = makeApi({});
    const report = await reconcileBetaReview(api, {
      appId: 'app-1',
      whatToTest: WHATS_NEW,
      submitForReview: true,
      dryRun: true,
    });
    expect(calls.created).toHaveLength(0);
    expect(calls.submitted).toHaveLength(0);
    expect(report.actions.every((action) => action.status === 'planned')).toBe(true);
    expect(report.actions).toHaveLength(2); // set notes + submit, both planned
  });

  it('captures a failed submission without aborting the notes that already applied', async () => {
    const { api } = makeApi({});
    api.createBetaAppReviewSubmission = () =>
      Promise.reject(new Error('build is still processing'));
    const report = await reconcileBetaReview(api, {
      appId: 'app-1',
      whatToTest: WHATS_NEW,
      submitForReview: true,
      dryRun: false,
    });
    const summary = summarizeBetaReview(report.actions);
    expect(summary).toEqual({ applied: 1, failed: 1, skipped: 0 });
    expect(report.actions.find((action) => action.status === 'failed')?.error).toBe(
      'build is still processing',
    );
  });
});
