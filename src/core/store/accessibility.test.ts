import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type {
  AccessibilityDeclarationResource,
  AccessibilitySupport,
  DeviceFamily,
} from '../types/appleCatalog.js';
import {
  type AccessibilityConfig,
  type AscAccessibilityApi,
  parseAccessibilityConfig,
  reconcileAccessibility,
  summarizeAccessibility,
} from './accessibility.js';
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
const makeApi = (
  state: Partial<State>,
): {
  api: AscAccessibilityApi;
  calls: Calls;
} => {
  const full: State = { appId: 'app-1', declarations: [], ...state };
  const calls: Calls = { created: [], updated: [] };
  const api: AscAccessibilityApi = {
    getAppId: () => Effect.succeed(full.appId),
    listAccessibilityDeclarations: () => Effect.succeed(full.declarations),
    createAccessibilityDeclaration: (_appId, deviceFamily, support) => {
      calls.created.push({ deviceFamily, support });
      return Effect.succeed({ id: 'decl-new', deviceFamily, state: 'DRAFT', support });
    },
    updateAccessibilityDeclaration: (id, changes) => {
      calls.updated.push({ id, changes });
      return Effect.void;
    },
  };
  return { api, calls };
};
/** Execute the accessibility reconciler at the test boundary. */
const runReconcile = (
  api: AscAccessibilityApi,
  input: Parameters<typeof reconcileAccessibility>[1],
) => Effect.runPromise(reconcileAccessibility(api, input));
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
const declaration = (
  partial: Partial<AccessibilityDeclarationResource> & {
    deviceFamily: DeviceFamily;
  },
): AccessibilityDeclarationResource => {
  return { id: 'decl-1', state: 'PUBLISHED', support: {}, ...partial };
};
const decodeAccessibilityConfig = (rawDocument: unknown) =>
  Effect.runSync(parseAccessibilityConfig(rawDocument));
describe('parseAccessibilityConfig', () => {
  it('parses declarations and the publish flag', () => {
    const config = decodeAccessibilityConfig({ publish: true, ...CONFIG });
    expect(config.declarations[0]?.deviceFamily).toBe('IPHONE');
    expect(config.declarations[0]?.supportsVoiceover).toBe(true);
    expect(config.publish).toBe(true);
  });
  it('rejects a non-object, an array, and an empty declaration list', () => {
    expect(() => decodeAccessibilityConfig('nope')).toThrow(/must be a JSON object/);
    expect(() => decodeAccessibilityConfig([])).toThrow(/must be a JSON object/);
    expect(() => decodeAccessibilityConfig({})).toThrow(/declarations/);
    expect(() => decodeAccessibilityConfig({ declarations: [] })).toThrow(/at least one entry/);
  });
  it('rejects a bad device family, a non-boolean flag, and a non-boolean publish', () => {
    expect(() => decodeAccessibilityConfig({ declarations: [{ deviceFamily: 'WATCH' }] })).toThrow(
      /deviceFamily/,
    );
    expect(() =>
      decodeAccessibilityConfig({
        declarations: [{ deviceFamily: 'IPHONE', supportsCaptions: 'yes' }],
      }),
    ).toThrow(/supportsCaptions/);
    expect(() => decodeAccessibilityConfig({ publish: 'yes', ...CONFIG })).toThrow(/publish/);
  });
  it('rejects two declarations for the same device family', () => {
    expect(() =>
      decodeAccessibilityConfig({
        declarations: [{ deviceFamily: 'IPHONE' }, { deviceFamily: 'IPHONE' }],
      }),
    ).toThrow(/duplicate declaration for device family IPHONE/);
  });
});
describe('reconcileAccessibility', () => {
  it('throws when the app has no App Store Connect record', async () => {
    const { api } = makeApi({ appId: null });
    await expect(
      runReconcile(api, { bundleId: 'com.acme.app', config: CONFIG, dryRun: true }),
    ).rejects.toThrow(/No App Store Connect app record/);
  });
  it('creates a declaration with the full nine-flag payload when the family has none (apply)', async () => {
    const { api, calls } = makeApi({});
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: CONFIG,
      dryRun: false,
    });
    expect(calls.created).toEqual([{ deviceFamily: 'IPHONE', support: FULL_IPHONE }]);
    expect(calls.updated).toHaveLength(0); // no publish requested
    expect(summarizeAccessibility(report.actions)).toEqual({ applied: 1, failed: 0, skipped: 0 });
  });
  it('publishes a freshly-created draft in a follow-up call when publish:true', async () => {
    const { api, calls } = makeApi({});
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: { ...CONFIG, publish: true },
      dryRun: false,
    });
    expect(calls.created).toHaveLength(1);
    expect(calls.updated).toEqual([{ id: 'decl-new', changes: { publish: true } }]);
    expect(summarizeAccessibility(report.actions)).toEqual({ applied: 2, failed: 0, skipped: 0 });
  });
  it('updates an existing declaration whose flags differ (no publish key when publish is off)', async () => {
    const { api, calls } = makeApi({
      declarations: [
        declaration({ deviceFamily: 'IPHONE', support: { supportsVoiceover: false } }),
      ],
    });
    await runReconcile(api, { bundleId: 'com.acme.app', config: CONFIG, dryRun: false });
    expect(calls.created).toHaveLength(0);
    expect(calls.updated).toEqual([{ id: 'decl-1', changes: FULL_IPHONE }]);
  });
  it('folds publish into the update PATCH when publish:true and flags changed', async () => {
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
  });
  it('publishes an unchanged draft (publish:true) without touching its flags', async () => {
    const { api, calls } = makeApi({
      declarations: [declaration({ deviceFamily: 'IPHONE', state: 'DRAFT', support: FULL_IPHONE })],
    });
    await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: { ...CONFIG, publish: true },
      dryRun: false,
    });
    expect(calls.updated).toEqual([{ id: 'decl-1', changes: { publish: true } }]);
  });
  it('is a no-op when the declaration is already published and in sync', async () => {
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
  });
  it('prefers the editable DRAFT over the live PUBLISHED one, and ignores REPLACED history', async () => {
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
  });
  it('plans but performs nothing on a dry-run', async () => {
    const { api, calls } = makeApi({});
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: { ...CONFIG, publish: true },
      dryRun: true,
    });
    expect(calls.created).toHaveLength(0);
    expect(calls.updated).toHaveLength(0);
    expect(report.actions.every((action) => action.status === 'planned')).toBe(true);
    expect(report.actions).toHaveLength(2); // create + publish, both planned
  });
  it("captures a failed create and skips that family's publish", async () => {
    const { api } = makeApi({});
    api.createAccessibilityDeclaration = () => Effect.fail(new Error('device family not eligible'));
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: { ...CONFIG, publish: true },
      dryRun: false,
    });
    const summary = summarizeAccessibility(report.actions);
    expect(summary).toEqual({ applied: 0, failed: 1, skipped: 1 });
    expect(report.actions.find((action) => action.status === 'failed')?.error).toBe(
      'device family not eligible',
    );
  });
});
