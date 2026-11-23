import { describe, expect, it } from 'vitest';
import type {
  AppClipDefaultExperienceResource,
  AppClipLocalizationResource,
  AppClipResource,
} from '@/types/apple-catalog.js';
import { summarize } from '@/store/shared/reconcile.js';
import { type AscAppClipsApi, parseAppClipsConfig, reconcileAppClips } from './app-clips.ts';
import type { AppClipsConfig } from '@/types/store-surface.js';
import type { ActionStatus } from '@/types/reconcile.js';

/** Records every write the reconciler makes, so a test can assert what was (and wasn't) sent. */
type Calls = {
  createdExperiences: {
    appClipId: string;
    versionId: string;
    action?: string;
  }[];
  updatedActions: {
    experienceId: string;
    action: string;
  }[];
  createdLocalizations: {
    experienceId: string;
    locale: string;
    subtitle: string;
  }[];
  updatedLocalizations: {
    localizationId: string;
    subtitle: string;
  }[];
};

/** State the fake API serves on reads - what App Store Connect already has. */
type State = {
  appId: string | null;
  editableVersionId: string | null;
  clips: AppClipResource[];
  experiences: Record<string, AppClipDefaultExperienceResource[]>;
  localizations: Record<string, AppClipLocalizationResource[]>;
};

/** A hand-rolled {@link AscAppClipsApi} - no network - returning `state` and recording writes in `calls`. */
function makeApi(state: Partial<State>): {
  api: AscAppClipsApi;
  calls: Calls;
} {
  const full: State = {
    appId: 'app-1',
    editableVersionId: 'ver-1',
    clips: [],
    experiences: {},
    localizations: {},
    ...state,
  };
  const calls: Calls = {
    createdExperiences: [],
    updatedActions: [],
    createdLocalizations: [],
    updatedLocalizations: [],
  };
  let nextId = 0;
  const api: AscAppClipsApi = {
    getAppId() {
      return Promise.resolve(full.appId);
    },
    findEditableAppStoreVersion() {
      if (full.editableVersionId == null) return Promise.resolve(null);

      return Promise.resolve({ id: full.editableVersionId });
    },
    listAppClips() {
      return Promise.resolve(full.clips);
    },
    listAppClipDefaultExperiences(appClipId) {
      let experiences: AppClipDefaultExperienceResource[] = [];

      if (full.experiences[appClipId] != null) experiences = full.experiences[appClipId];

      return Promise.resolve(experiences);
    },
    createAppClipDefaultExperience(appClipId, versionId, action) {
      const createdExperience: Calls['createdExperiences'][number] = {
        appClipId,
        versionId,
      };

      if (action != null) createdExperience.action = action;

      calls.createdExperiences.push(createdExperience);

      return Promise.resolve({ id: `exp-new-${++nextId}` });
    },
    updateAppClipDefaultExperienceAction(experienceId, action) {
      calls.updatedActions.push({ experienceId, action });
      return Promise.resolve();
    },
    listAppClipDefaultExperienceLocalizations(experienceId) {
      let localizations: AppClipLocalizationResource[] = [];

      if (full.localizations[experienceId] != null) {
        localizations = full.localizations[experienceId];
      }

      return Promise.resolve(localizations);
    },
    createAppClipDefaultExperienceLocalization(experienceId, locale, subtitle) {
      calls.createdLocalizations.push({ experienceId, locale, subtitle });
      return Promise.resolve();
    },
    updateAppClipDefaultExperienceLocalization(localizationId, subtitle) {
      calls.updatedLocalizations.push({ localizationId, subtitle });
      return Promise.resolve();
    },
  };

  return { api, calls };
}

/** Execute the App Clips reconciler at the test boundary. */
function runReconcile(api: AscAppClipsApi, input: Parameters<typeof reconcileAppClips>[1]) {
  return reconcileAppClips(api, input);
}
const ONE_CLIP: AppClipsConfig = {
  clips: {
    'com.acme.app.Clip': { action: 'OPEN', localizations: { 'en-US': { subtitle: 'Order now' } } },
  },
};

function decodeAppClipsConfig(rawDocument: unknown) {
  return parseAppClipsConfig(rawDocument);
}

function describeParseAppClipsPiece() {
  function parsesAClipWithAnActionAndLocalizations() {
    const config = decodeAppClipsConfig(ONE_CLIP);

    expect(config.clips['com.acme.app.Clip']).toEqual({
      action: 'OPEN',
      localizations: { 'en-US': { subtitle: 'Order now' } },
    });
  }

  it('parses a clip with an action and localizations', parsesAClipWithAnActionAndLocalizations);

  function rejectsANonObjectDocumentAnArrayAndAnEmptyClipsMap() {
    function callDecodeAppClipsPiece() {
      return decodeAppClipsConfig('nope');
    }

    expect(callDecodeAppClipsPiece).toThrow(/must be a JSON object/);

    function callDecodeAppClipsPiece2() {
      return decodeAppClipsConfig([]);
    }

    expect(callDecodeAppClipsPiece2).toThrow(/must be a JSON object/);

    function callDecodeAppClipsPiece3() {
      return decodeAppClipsConfig({});
    }

    expect(callDecodeAppClipsPiece3).toThrow(/clips/);

    function callDecodeAppClipsPiece4() {
      return decodeAppClipsConfig({ clips: {} });
    }

    expect(callDecodeAppClipsPiece4).toThrow(/at least one App Clip/);

    function callDecodeAppClipsPiece5() {
      return decodeAppClipsConfig({ clips: [] });
    }

    expect(callDecodeAppClipsPiece5).toThrow(/clips/);
  }

  it(
    'rejects a non-object document, an array, and an empty clips map',
    rejectsANonObjectDocumentAnArrayAndAnEmptyClipsMap,
  );

  function rejectsAnInvalidActionAndANonStringSubtitle() {
    function callDecodeAppClipsPiece6() {
      return decodeAppClipsConfig({ clips: { c: { action: 'TAP' } } });
    }

    expect(callDecodeAppClipsPiece6).toThrow(/action/);

    function callDecodeAppClipsPiece7() {
      return decodeAppClipsConfig({
        clips: { c: { localizations: { 'en-US': { subtitle: 1 } } } },
      });
    }

    expect(callDecodeAppClipsPiece7).toThrow(/subtitle must be a string/);
  }

  it(
    'rejects an invalid action and a non-string subtitle',
    rejectsAnInvalidActionAndANonStringSubtitle,
  );

  function rejectsAClipThatDeclaresNeitherAnActionNorLocalizations() {
    function callDecodeAppClipsPiece8() {
      return decodeAppClipsConfig({ clips: { c: {} } });
    }

    expect(callDecodeAppClipsPiece8).toThrow(/declares nothing/);
  }

  it(
    'rejects a clip that declares neither an action nor localizations',
    rejectsAClipThatDeclaresNeitherAnActionNorLocalizations,
  );
}

describe('parseAppClipsConfig', describeParseAppClipsPiece);

function describeReconcileAppClips() {
  const clip: AppClipResource = { id: 'clip-1', bundleId: 'com.acme.app.Clip' };

  async function throwsWhenTheAppHasNoAppStoreConnectPiece() {
    const { api } = makeApi({ appId: null });
    const reconcile = runReconcile(api, {
      bundleId: 'com.acme.app',
      config: ONE_CLIP,
      dryRun: true,
    });

    await expect(reconcile).rejects.toThrow(/No App Store Connect app record/);
  }

  it(
    'throws when the app has no App Store Connect record',
    throwsWhenTheAppHasNoAppStoreConnectPiece,
  );

  async function skipsEveryClipWhenThereSNoEditableAppStoreVersion() {
    const { api, calls } = makeApi({ editableVersionId: null, clips: [clip] });
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: ONE_CLIP,
      dryRun: false,
    });

    expect(report.actions).toEqual([
      {
        description: 'App Clips: no editable App Store version (create/select a version first)',
        destructive: false,
        status: 'skipped',
      },
    ]);
    expect(calls.createdExperiences).toHaveLength(0);
  }

  it(
    "skips every clip when there's no editable App Store version",
    skipsEveryClipWhenThereSNoEditableAppStoreVersion,
  );

  async function skipsADeclaredClipWhoseBuildHasnTProducedAClipPiece() {
    const { api } = makeApi({ clips: [] });
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: ONE_CLIP,
      dryRun: false,
    });

    expect(report.actions).toHaveLength(1);
    expect(report.actions[0]?.status).toBe('skipped');
    expect(report.actions[0]?.description).toMatch(
      /upload a build with this App Clip target first/,
    );
  }

  it(
    "skips a declared clip whose build hasn't produced a clip record",
    skipsADeclaredClipWhoseBuildHasnTProducedAClipPiece,
  );

  async function createsTheDefaultExperienceAndItsSubtitleWhenNoneExistsApply() {
    const { api, calls } = makeApi({ clips: [clip] });
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: ONE_CLIP,
      dryRun: false,
    });

    expect(calls.createdExperiences).toEqual([
      { appClipId: 'clip-1', versionId: 'ver-1', action: 'OPEN' },
    ]);
    expect(calls.createdLocalizations).toEqual([
      { experienceId: 'exp-new-1', locale: 'en-US', subtitle: 'Order now' },
    ]);
    expect(summarize(report.actions)).toEqual({ applied: 2, failed: 0, skipped: 0 });
  }

  it(
    'creates the default experience and its subtitle when none exists (apply)',
    createsTheDefaultExperienceAndItsSubtitleWhenNoneExistsApply,
  );

  async function plansButDoesNotPerformCreatesOnADryRunIncludingTheSubtitleOfANotYetCreatedExperience() {
    const { api, calls } = makeApi({ clips: [clip] });
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: ONE_CLIP,
      dryRun: true,
    });

    expect(calls.createdExperiences).toHaveLength(0);
    expect(calls.createdLocalizations).toHaveLength(0);

    function readStatus(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status;
    }

    expect(report.actions.map(readStatus)).toEqual(['planned', 'planned']);
    expect(report.actions[1]?.description).toBe('set com.acme.app.Clip card subtitle (en-US)');
  }

  it(
    'plans (but does not perform) creates on a dry-run, including the subtitle of a not-yet-created experience',
    plansButDoesNotPerformCreatesOnADryRunIncludingTheSubtitleOfANotYetCreatedExperience,
  );

  async function updatesOnlyTheActionAndTheChangedSubtitleLeavingInSyncFieldsUntouched() {
    const { api, calls } = makeApi({
      clips: [clip],
      experiences: { 'clip-1': [{ id: 'exp-1', action: 'VIEW', versionId: 'ver-1' }] },
      localizations: { 'exp-1': [{ id: 'loc-1', locale: 'en-US', subtitle: 'Old copy' }] },
    });
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: ONE_CLIP,
      dryRun: false,
    });

    expect(calls.updatedActions).toEqual([{ experienceId: 'exp-1', action: 'OPEN' }]);
    expect(calls.updatedLocalizations).toEqual([
      { localizationId: 'loc-1', subtitle: 'Order now' },
    ]);
    expect(calls.createdExperiences).toHaveLength(0);
    expect(summarize(report.actions)).toEqual({ applied: 2, failed: 0, skipped: 0 });
  }

  it(
    'updates only the action and the changed subtitle, leaving in-sync fields untouched',
    updatesOnlyTheActionAndTheChangedSubtitleLeavingInSyncFieldsUntouched,
  );

  async function makesNoChangesWhenTheExperienceAndSubtitleAlreadyPiece() {
    const { api, calls } = makeApi({
      clips: [clip],
      experiences: { 'clip-1': [{ id: 'exp-1', action: 'OPEN', versionId: 'ver-1' }] },
      localizations: { 'exp-1': [{ id: 'loc-1', locale: 'en-US', subtitle: 'Order now' }] },
    });
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: ONE_CLIP,
      dryRun: false,
    });

    expect(report.actions).toHaveLength(0);
    expect(calls.updatedActions).toHaveLength(0);
    expect(calls.updatedLocalizations).toHaveLength(0);
  }

  it(
    'makes no changes when the experience and subtitle already match',
    makesNoChangesWhenTheExperienceAndSubtitleAlreadyPiece,
  );

  async function ignoresAnExperienceTiedToADifferentNonEditableVersion() {
    const { api, calls } = makeApi({
      clips: [clip],
      experiences: { 'clip-1': [{ id: 'exp-old', action: 'OPEN', versionId: 'ver-released' }] },
    });

    await runReconcile(api, { bundleId: 'com.acme.app', config: ONE_CLIP, dryRun: false });
    // The editable-version experience doesn't exist yet -> a fresh one is created, not the released one reused.
    expect(calls.createdExperiences).toEqual([
      { appClipId: 'clip-1', versionId: 'ver-1', action: 'OPEN' },
    ]);
  }

  it(
    'ignores an experience tied to a different (non-editable) version',
    ignoresAnExperienceTiedToADifferentNonEditableVersion,
  );

  async function capturesAFailedExperienceCreateAndSkipsThatClipSSubtitles() {
    const { api, calls } = makeApi({ clips: [clip] });

    function runPiece() {
      return Promise.reject(new Error('boom'));
    }

    api.createAppClipDefaultExperience = runPiece;

    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: ONE_CLIP,
      dryRun: false,
    });
    const summary = summarize(report.actions);

    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(calls.createdLocalizations).toHaveLength(0);

    function isFailedAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'failed';
    }

    expect(report.actions.find(isFailedAction)?.error).toBe('boom');
  }

  it(
    "captures a failed experience create and skips that clip's subtitles",
    capturesAFailedExperienceCreateAndSkipsThatClipSSubtitles,
  );
}

describe('reconcileAppClips', describeReconcileAppClips);
