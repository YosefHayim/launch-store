import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type {
  BetaAppReviewSubmissionResource,
  BetaBuildLocalizationResource,
  BuildResource,
} from '../types/appleCatalog.js';
import {
  type AscBetaReviewApi,
  parseBetaReviewConfig,
  reconcileBetaReview,
  summarizeBetaReview,
} from './betaReview.js';

type Calls = {
  created: { buildId: string; locale: string; whatsNew: string }[];
  updated: { localizationId: string; whatsNew: string }[];
  submitted: string[];
};

type State = {
  builds: BuildResource[];
  localizations: BetaBuildLocalizationResource[];
  submission: BetaAppReviewSubmissionResource | null;
  submissionFailure?: string;
};

const VALID_BUILD: BuildResource = {
  id: 'build-1',
  version: '42',
  processingState: 'VALID',
  expired: false,
};

/** Create a hand fake that records beta-review writes. */
const makeAppleStore = (
  state: Partial<State>,
): Readonly<{ appleStore: AscBetaReviewApi; calls: Calls }> => {
  const storedState: State = {
    builds: [VALID_BUILD],
    localizations: [],
    submission: null,
    ...state,
  };
  const calls: Calls = { created: [], updated: [], submitted: [] };
  const appleStore: AscBetaReviewApi = {
    listBuilds: () => Effect.succeed(storedState.builds),
    listBetaBuildLocalizations: () => Effect.succeed(storedState.localizations),
    createBetaBuildLocalization: (buildId, locale, whatsNew) =>
      Effect.sync(() => {
        calls.created.push({ buildId, locale, whatsNew });
      }),
    updateBetaBuildLocalization: (localizationId, whatsNew) =>
      Effect.sync(() => {
        calls.updated.push({ localizationId, whatsNew });
      }),
    getBetaAppReviewSubmission: () => Effect.succeed(storedState.submission),
    createBetaAppReviewSubmission: (buildId) => {
      if (storedState.submissionFailure !== undefined) {
        return Effect.fail(new Error(storedState.submissionFailure));
      }
      return Effect.sync(() => {
        calls.submitted.push(buildId);
      });
    },
  };
  return { appleStore, calls };
};

const WHAT_TO_TEST = { 'en-US': 'Bug fixes.' };

describe('parseBetaReviewConfig', () => {
  it('decodes a non-empty localized note map', () => {
    expect(Effect.runSync(parseBetaReviewConfig({ whatToTest: WHAT_TO_TEST }))).toEqual({
      whatToTest: WHAT_TO_TEST,
    });
  });

  it('rejects malformed documents at the schema boundary', () => {
    for (const invalidConfiguration of [
      'nope',
      {},
      { whatToTest: {} },
      { whatToTest: { 'en-US': '' } },
    ]) {
      expect(() => Effect.runSync(parseBetaReviewConfig(invalidConfiguration))).toThrow();
    }
  });
});

describe('reconcileBetaReview', () => {
  it('sets a new note and submits the build for review', async () => {
    const { appleStore, calls } = makeAppleStore({});
    const report = await Effect.runPromise(
      reconcileBetaReview(appleStore, {
        appId: 'app-1',
        whatToTest: WHAT_TO_TEST,
        submitForReview: true,
        dryRun: false,
      }),
    );
    expect(report.buildVersion).toBe('42');
    expect(calls.created).toEqual([
      { buildId: 'build-1', locale: 'en-US', whatsNew: 'Bug fixes.' },
    ]);
    expect(calls.submitted).toEqual(['build-1']);
    expect(summarizeBetaReview(report.actions)).toEqual({ applied: 2, failed: 0, skipped: 0 });
  });

  it('updates changed notes and leaves identical notes alone', async () => {
    const changed = makeAppleStore({
      localizations: [{ id: 'loc-1', locale: 'en-US', whatsNew: 'Old notes.' }],
    });
    await Effect.runPromise(
      reconcileBetaReview(changed.appleStore, {
        appId: 'app-1',
        whatToTest: WHAT_TO_TEST,
        submitForReview: false,
        dryRun: false,
      }),
    );
    expect(changed.calls.created).toHaveLength(0);
    expect(changed.calls.updated).toEqual([{ localizationId: 'loc-1', whatsNew: 'Bug fixes.' }]);

    const identical = makeAppleStore({
      localizations: [{ id: 'loc-1', locale: 'en-US', whatsNew: 'Bug fixes.' }],
    });
    const report = await Effect.runPromise(
      reconcileBetaReview(identical.appleStore, {
        appId: 'app-1',
        whatToTest: WHAT_TO_TEST,
        submitForReview: false,
        dryRun: false,
      }),
    );
    expect(identical.calls.updated).toHaveLength(0);
    expect(report.actions).toHaveLength(0);
  });

  it('skips a build that was already submitted', async () => {
    const { appleStore, calls } = makeAppleStore({
      submission: { id: 'sub-1', state: 'IN_REVIEW' },
    });
    const report = await Effect.runPromise(
      reconcileBetaReview(appleStore, {
        appId: 'app-1',
        whatToTest: {},
        submitForReview: true,
        dryRun: false,
      }),
    );
    expect(calls.submitted).toHaveLength(0);
    expect(summarizeBetaReview(report.actions)).toEqual({ applied: 0, failed: 0, skipped: 1 });
    expect(report.actions[0]?.description).toContain('in review');
  });

  it('targets a requested build and rejects expired or missing builds', async () => {
    const builds: BuildResource[] = [
      { id: 'build-2', version: '43', processingState: 'VALID', expired: false },
      { id: 'build-1', version: '42', processingState: 'VALID', expired: true },
    ];
    const { appleStore, calls } = makeAppleStore({ builds });
    const report = await Effect.runPromise(
      reconcileBetaReview(appleStore, {
        appId: 'app-1',
        buildVersion: '43',
        whatToTest: WHAT_TO_TEST,
        submitForReview: false,
        dryRun: false,
      }),
    );
    expect(report.buildVersion).toBe('43');
    expect(calls.created[0]?.buildId).toBe('build-2');
    await expect(
      Effect.runPromise(
        reconcileBetaReview(appleStore, {
          appId: 'app-1',
          buildVersion: '42',
          whatToTest: {},
          submitForReview: false,
          dryRun: false,
        }),
      ),
    ).rejects.toThrow(/expired/);
    await expect(
      Effect.runPromise(
        reconcileBetaReview(appleStore, {
          appId: 'app-1',
          buildVersion: '99',
          whatToTest: {},
          submitForReview: false,
          dryRun: false,
        }),
      ),
    ).rejects.toThrow(/No build 99/);
  });

  it('picks the newest valid build when no version is given', async () => {
    const { appleStore } = makeAppleStore({
      builds: [
        { id: 'processing', version: '44', processingState: 'PROCESSING', expired: false },
        { id: 'good', version: '43', processingState: 'VALID', expired: false },
        { id: 'old', version: '42', processingState: 'VALID', expired: false },
      ],
    });
    const report = await Effect.runPromise(
      reconcileBetaReview(appleStore, {
        appId: 'app-1',
        whatToTest: {},
        submitForReview: false,
        dryRun: false,
      }),
    );
    expect(report.buildVersion).toBe('43');
  });

  it('rejects when no build is eligible', async () => {
    const { appleStore } = makeAppleStore({
      builds: [{ id: 'p', version: '1', processingState: 'PROCESSING', expired: false }],
    });
    await expect(
      Effect.runPromise(
        reconcileBetaReview(appleStore, {
          appId: 'app-1',
          whatToTest: {},
          submitForReview: true,
          dryRun: false,
        }),
      ),
    ).rejects.toThrow(/No VALID, non-expired build/);
  });

  it('plans without writes on a dry run', async () => {
    const { appleStore, calls } = makeAppleStore({});
    const report = await Effect.runPromise(
      reconcileBetaReview(appleStore, {
        appId: 'app-1',
        whatToTest: WHAT_TO_TEST,
        submitForReview: true,
        dryRun: true,
      }),
    );
    expect(calls.created).toHaveLength(0);
    expect(calls.submitted).toHaveLength(0);
    expect(report.actions.every((action) => action.status === 'planned')).toBe(true);
    expect(report.actions).toHaveLength(2);
  });

  it('captures a submission failure after applying notes', async () => {
    const { appleStore } = makeAppleStore({ submissionFailure: 'build is still processing' });
    const report = await Effect.runPromise(
      reconcileBetaReview(appleStore, {
        appId: 'app-1',
        whatToTest: WHAT_TO_TEST,
        submitForReview: true,
        dryRun: false,
      }),
    );
    expect(summarizeBetaReview(report.actions)).toEqual({ applied: 1, failed: 1, skipped: 0 });
    expect(report.actions.find((action) => action.status === 'failed')?.error).toBe(
      'build is still processing',
    );
  });
});
