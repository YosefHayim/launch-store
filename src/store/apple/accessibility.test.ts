import { describe, expect, it } from 'vitest';
import type {
  AccessibilityDeclarationResource,
  AccessibilitySupport,
  DeviceFamily,
} from '@/types/apple-catalog.js';
import {
  type AccessibilityConfig,
  type AscAccessibilityApi,
  parseAccessibilityConfig,
  reconcileAccessibility,
  summarizeAccessibility,
} from './accessibility.ts';
import type { ActionStatus } from '@/types/reconcile.js';

/** Records every write the reconciler makes, so a test can assert what was (and wasn't) sent. */
type Calls = {
  created: {
    deviceFamily: DeviceFamily;
    support: AccessibilitySupport;
  }[];
  updated: {
    id: string;
    changes: AccessibilitySupport & {
      publish?: boolean;
    };
  }[];
};

/** State the fake API serves on reads - what App Store Connect already has. */
type State = {
  appId: string | null;
  declarations: AccessibilityDeclarationResource[];
};

/** A hand-rolled {@link AscAccessibilityApi} - no network - returning `state` and recording writes in `calls`. */
function makeApi(state: Partial<State>): {
  api: AscAccessibilityApi;
  calls: Calls;
} {
  const full: State = { appId: 'app-1', declarations: [], ...state };
  const calls: Calls = { created: [], updated: [] };
  const api: AscAccessibilityApi = {
    getAppId() {
      return Promise.resolve(full.appId);
    },
    listAccessibilityDeclarations() {
      return Promise.resolve(full.declarations);
    },
    createAccessibilityDeclaration(_appId, deviceFamily, support) {
      calls.created.push({ deviceFamily, support });
      return Promise.resolve({ id: 'decl-new', deviceFamily, state: 'DRAFT', support });
    },
    updateAccessibilityDeclaration(id, changes) {
      calls.updated.push({ id, changes });
      return Promise.resolve();
    },
  };

  return { api, calls };
}

/** Execute the accessibility reconciler at the test boundary. */
function runReconcile(
  api: AscAccessibilityApi,
  input: Parameters<typeof reconcileAccessibility>[1],
) {
  return reconcileAccessibility(api, input);
}
/** The nine-flag payload Launch writes for `{ supportsVoiceover, supportsCaptions }` true, all others false. */
const FULL_IPHONE: AccessibilitySupport = {
  supportsAudioDescriptions: false,
  supportsCaptions: true,
  supportsDarkInterface: false,
  supportsDifferentiateWithoutColorAlone: false,
  supportsLargerText: false,
  supportsReducedMotion: false,
  supportsSufficientContrast: false,
  supportsVoiceControl: false,
  supportsVoiceover: true,
};
const CONFIG: AccessibilityConfig = {
  declarations: [{ deviceFamily: 'IPHONE', supportsVoiceover: true, supportsCaptions: true }],
};

/** A declaration the fake API can serve as already-present state. */
function declaration(
  partial: Partial<AccessibilityDeclarationResource> & {
    deviceFamily: DeviceFamily;
  },
): AccessibilityDeclarationResource {
  return { id: 'decl-1', state: 'PUBLISHED', support: {}, ...partial };
}

function decodeAccessibilityConfig(rawDocument: unknown) {
  return parseAccessibilityConfig(rawDocument);
}

function describeParseAccessibilityPiece() {
  function parsesDeclarationsAndThePublishFlag() {
    const config = decodeAccessibilityConfig({ publish: true, ...CONFIG });
    expect(config.declarations[0]?.deviceFamily).toBe('IPHONE');
    expect(config.declarations[0]?.supportsVoiceover).toBe(true);
    expect(config.publish).toBe(true);
  }

  it('parses declarations and the publish flag', parsesDeclarationsAndThePublishFlag);

  function rejectsANonObjectAnArrayAndAnEmptyDeclarationList() {
    function callDecodeAccessibilityPiece() {
      return decodeAccessibilityConfig('nope');
    }

    expect(callDecodeAccessibilityPiece).toThrow(/must be a JSON object/);

    function callDecodeAccessibilityPiece2() {
      return decodeAccessibilityConfig([]);
    }

    expect(callDecodeAccessibilityPiece2).toThrow(/must be a JSON object/);

    function callDecodeAccessibilityPiece3() {
      return decodeAccessibilityConfig({});
    }

    expect(callDecodeAccessibilityPiece3).toThrow(/declarations/);

    function callDecodeAccessibilityPiece4() {
      return decodeAccessibilityConfig({ declarations: [] });
    }

    expect(callDecodeAccessibilityPiece4).toThrow(/at least one entry/);
  }

  it(
    'rejects a non-object, an array, and an empty declaration list',
    rejectsANonObjectAnArrayAndAnEmptyDeclarationList,
  );

  function rejectsABadDeviceFamilyANonBooleanFlagAndANonBooleanPublish() {
    function callDecodeAccessibilityPiece5() {
      return decodeAccessibilityConfig({ declarations: [{ deviceFamily: 'WATCH' }] });
    }

    expect(callDecodeAccessibilityPiece5).toThrow(/deviceFamily/);

    function callDecodeAccessibilityPiece6() {
      return decodeAccessibilityConfig({
        declarations: [{ deviceFamily: 'IPHONE', supportsCaptions: 'yes' }],
      });
    }

    expect(callDecodeAccessibilityPiece6).toThrow(/supportsCaptions/);

    function callDecodeAccessibilityPiece7() {
      return decodeAccessibilityConfig({ publish: 'yes', ...CONFIG });
    }

    expect(callDecodeAccessibilityPiece7).toThrow(/publish/);
  }

  it(
    'rejects a bad device family, a non-boolean flag, and a non-boolean publish',
    rejectsABadDeviceFamilyANonBooleanFlagAndANonBooleanPublish,
  );

  function rejectsTwoDeclarationsForTheSameDeviceFamily() {
    function callDecodeAccessibilityPiece8() {
      return decodeAccessibilityConfig({
        declarations: [{ deviceFamily: 'IPHONE' }, { deviceFamily: 'IPHONE' }],
      });
    }

    expect(callDecodeAccessibilityPiece8).toThrow(/duplicate declaration for device family IPHONE/);
  }

  it(
    'rejects two declarations for the same device family',
    rejectsTwoDeclarationsForTheSameDeviceFamily,
  );
}

describe('parseAccessibilityConfig', describeParseAccessibilityPiece);

function describeReconcileAccessibility() {
  async function throwsWhenTheAppHasNoAppStoreConnectPiece() {
    const { api } = makeApi({ appId: null });
    const reconcile = runReconcile(api, { bundleId: 'com.acme.app', config: CONFIG, dryRun: true });
    await expect(reconcile).rejects.toThrow(/No App Store Connect app record/);
  }

  it(
    'throws when the app has no App Store Connect record',
    throwsWhenTheAppHasNoAppStoreConnectPiece,
  );

  async function createsADeclarationWithTheFullNineFlagPieceWhenTheFamilyHasNoneApply() {
    const { api, calls } = makeApi({});
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: CONFIG,
      dryRun: false,
    });

    expect(calls.created).toEqual([{ deviceFamily: 'IPHONE', support: FULL_IPHONE }]);
    expect(calls.updated).toHaveLength(0); // no publish requested

    const accessibility = summarizeAccessibility(report.actions);

    expect(accessibility).toEqual({ applied: 1, failed: 0, skipped: 0 });
  }

  it(
    'creates a declaration with the full nine-flag payload when the family has none (apply)',
    createsADeclarationWithTheFullNineFlagPieceWhenTheFamilyHasNoneApply,
  );

  async function publishesAFreshlyCreatedDraftInAFollowUpCallWhenPublishTrue() {
    const { api, calls } = makeApi({});
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: { ...CONFIG, publish: true },
      dryRun: false,
    });

    expect(calls.created).toHaveLength(1);
    expect(calls.updated).toEqual([{ id: 'decl-new', changes: { publish: true } }]);

    const accessibility = summarizeAccessibility(report.actions);

    expect(accessibility).toEqual({ applied: 2, failed: 0, skipped: 0 });
  }

  it(
    'publishes a freshly-created draft in a follow-up call when publish:true',
    publishesAFreshlyCreatedDraftInAFollowUpCallWhenPublishTrue,
  );

  async function updatesAnExistingDeclarationWhoseFlagsDifferNoPublishKeyWhenPublishIsOff() {
    const { api, calls } = makeApi({
      declarations: [
        declaration({ deviceFamily: 'IPHONE', support: { supportsVoiceover: false } }),
      ],
    });

    await runReconcile(api, { bundleId: 'com.acme.app', config: CONFIG, dryRun: false });
    expect(calls.created).toHaveLength(0);
    expect(calls.updated).toEqual([{ id: 'decl-1', changes: FULL_IPHONE }]);
  }

  it(
    'updates an existing declaration whose flags differ (no publish key when publish is off)',
    updatesAnExistingDeclarationWhoseFlagsDifferNoPublishKeyWhenPublishIsOff,
  );

  async function foldsPublishIntoTheUpdatePATCHWhenPublishTrueAndFlagsChanged() {
    const { api, calls } = makeApi({
      declarations: [
        declaration({ deviceFamily: 'IPHONE', support: { supportsVoiceover: false } }),
      ],
    });

    await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: { ...CONFIG, publish: true },
      dryRun: false,
    });
    expect(calls.updated).toEqual([{ id: 'decl-1', changes: { ...FULL_IPHONE, publish: true } }]);
  }

  it(
    'folds publish into the update PATCH when publish:true and flags changed',
    foldsPublishIntoTheUpdatePATCHWhenPublishTrueAndFlagsChanged,
  );

  async function publishesAnUnchangedDraftPublishTrueWithoutTouchingItsFlags() {
    const { api, calls } = makeApi({
      declarations: [declaration({ deviceFamily: 'IPHONE', state: 'DRAFT', support: FULL_IPHONE })],
    });

    await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: { ...CONFIG, publish: true },
      dryRun: false,
    });
    expect(calls.updated).toEqual([{ id: 'decl-1', changes: { publish: true } }]);
  }

  it(
    'publishes an unchanged draft (publish:true) without touching its flags',
    publishesAnUnchangedDraftPublishTrueWithoutTouchingItsFlags,
  );

  async function isANoOpWhenTheDeclarationIsAlreadyPublishedAndInSync() {
    const { api, calls } = makeApi({
      declarations: [
        declaration({ deviceFamily: 'IPHONE', state: 'PUBLISHED', support: FULL_IPHONE }),
      ],
    });
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: { ...CONFIG, publish: true },
      dryRun: false,
    });

    expect(calls.created).toHaveLength(0);
    expect(calls.updated).toHaveLength(0);
    expect(report.actions).toHaveLength(0);
  }

  it(
    'is a no-op when the declaration is already published and in sync',
    isANoOpWhenTheDeclarationIsAlreadyPublishedAndInSync,
  );

  async function prefersTheEditableDRAFTOverTheLivePUBLISHEDOneAndIgnoresREPLACEDHistory() {
    const { api, calls } = makeApi({
      declarations: [
        declaration({
          id: 'replaced-1',
          deviceFamily: 'IPHONE',
          state: 'REPLACED',
          support: FULL_IPHONE,
        }),
        declaration({ id: 'published-1', deviceFamily: 'IPHONE', state: 'PUBLISHED', support: {} }),
        declaration({ id: 'draft-1', deviceFamily: 'IPHONE', state: 'DRAFT', support: {} }),
      ],
    });

    await runReconcile(api, { bundleId: 'com.acme.app', config: CONFIG, dryRun: false });
    expect(calls.created).toHaveLength(0);
    expect(calls.updated).toEqual([{ id: 'draft-1', changes: FULL_IPHONE }]);
  }

  it(
    'prefers the editable DRAFT over the live PUBLISHED one, and ignores REPLACED history',
    prefersTheEditableDRAFTOverTheLivePUBLISHEDOneAndIgnoresREPLACEDHistory,
  );

  async function plansButPerformsNothingOnADryRun() {
    const { api, calls } = makeApi({});
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: { ...CONFIG, publish: true },
      dryRun: true,
    });

    expect(calls.created).toHaveLength(0);
    expect(calls.updated).toHaveLength(0);

    function isPlannedAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'planned';
    }

    expect(report.actions.every(isPlannedAction)).toBe(true);
    expect(report.actions).toHaveLength(2); // create + publish, both planned
  }

  it('plans but performs nothing on a dry-run', plansButPerformsNothingOnADryRun);

  async function capturesAFailedCreateAndSkipsThatFamilySPublish() {
    const { api } = makeApi({});

    function runPiece() {
      return Promise.reject(new Error('device family not eligible'));
    }

    api.createAccessibilityDeclaration = runPiece;

    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: { ...CONFIG, publish: true },
      dryRun: false,
    });
    const summary = summarizeAccessibility(report.actions);

    expect(summary).toEqual({ applied: 0, failed: 1, skipped: 1 });

    function isFailedAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'failed';
    }

    expect(report.actions.find(isFailedAction)?.error).toBe('device family not eligible');
  }

  it(
    "captures a failed create and skips that family's publish",
    capturesAFailedCreateAndSkipsThatFamilySPublish,
  );
}

describe('reconcileAccessibility', describeReconcileAccessibility);
