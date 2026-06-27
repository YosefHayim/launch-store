import { describe, expect, it } from 'vitest';
import type { ExperimentTreatmentResource, VersionExperimentResource } from '../apple/ascClient.js';
import {
  type AscExperimentsApi,
  type VersionExperimentsConfig,
  parseVersionExperimentsConfig,
  reconcileVersionExperiments,
  summarizeExperiments,
} from './versionExperiments.js';

/** Records every write the reconciler makes. */
interface Calls {
  createdExperiments: { name: string; platform: string; trafficProportion: number }[];
  createdTreatments: { experimentId: string; name: string }[];
}

/** State the fake API serves on reads. */
interface State {
  appId: string | null;
  experiments: VersionExperimentResource[];
  treatments: ExperimentTreatmentResource[];
}

function makeApi(state: Partial<State>): { api: AscExperimentsApi; calls: Calls } {
  const full: State = { appId: 'app-1', experiments: [], treatments: [], ...state };
  const calls: Calls = { createdExperiments: [], createdTreatments: [] };
  const api: AscExperimentsApi = {
    getAppId: () => Promise.resolve(full.appId),
    listVersionExperiments: () => Promise.resolve(full.experiments),
    createVersionExperiment: (_appId, input) => {
      calls.createdExperiments.push(input);
      return Promise.resolve({ id: 'exp-new', name: input.name, state: 'PREPARE_FOR_SUBMISSION' });
    },
    listExperimentTreatments: () => Promise.resolve(full.treatments),
    createExperimentTreatment: (experimentId, input) => {
      calls.createdTreatments.push({ experimentId, name: input.name });
      return Promise.resolve({ id: 'treat-new', name: input.name });
    },
  };
  return { api, calls };
}

const CONFIG: VersionExperimentsConfig = {
  experiments: [
    {
      name: 'Icon Test',
      trafficProportion: 50,
      treatments: [{ name: 'Variant A' }, { name: 'Variant B' }],
    },
  ],
};

describe('parseVersionExperimentsConfig', () => {
  it('parses experiments with treatments', () => {
    const config = parseVersionExperimentsConfig(CONFIG);
    expect(config.experiments[0]?.name).toBe('Icon Test');
    expect(config.experiments[0]?.treatments?.map((treatment) => treatment.name)).toEqual([
      'Variant A',
      'Variant B',
    ]);
  });

  it('rejects a non-object, an empty list, a bad traffic proportion, and a duplicate name', () => {
    expect(() => parseVersionExperimentsConfig('nope')).toThrow(/must be a JSON object/);
    expect(() => parseVersionExperimentsConfig({ experiments: [] })).toThrow(/at least one entry/);
    expect(() =>
      parseVersionExperimentsConfig({ experiments: [{ name: 'X', trafficProportion: 0 }] }),
    ).toThrow(/trafficProportion must be a positive number/);
    expect(() =>
      parseVersionExperimentsConfig({
        experiments: [
          { name: 'X', trafficProportion: 10 },
          { name: 'X', trafficProportion: 20 },
        ],
      }),
    ).toThrow(/duplicate experiment name "X"/);
  });
});

describe('reconcileVersionExperiments', () => {
  it('throws when the app has no App Store Connect record', async () => {
    const { api } = makeApi({ appId: null });
    await expect(
      reconcileVersionExperiments(api, { bundleId: 'com.acme.app', config: CONFIG, dryRun: true }),
    ).rejects.toThrow(/No App Store Connect app record/);
  });

  it('creates a missing experiment and each treatment (apply)', async () => {
    const { api, calls } = makeApi({});
    const report = await reconcileVersionExperiments(api, {
      bundleId: 'com.acme.app',
      config: CONFIG,
      dryRun: false,
    });
    expect(calls.createdExperiments).toEqual([
      { name: 'Icon Test', platform: 'IOS', trafficProportion: 50 },
    ]);
    expect(calls.createdTreatments).toEqual([
      { experimentId: 'exp-new', name: 'Variant A' },
      { experimentId: 'exp-new', name: 'Variant B' },
    ]);
    expect(summarizeExperiments(report.actions)).toEqual({ applied: 3, failed: 0, skipped: 0 });
  });

  it("only creates treatments the existing experiment doesn't already have", async () => {
    const { api, calls } = makeApi({
      experiments: [{ id: 'exp-1', name: 'Icon Test', state: 'PREPARE_FOR_SUBMISSION' }],
      treatments: [{ id: 't-a', name: 'Variant A' }],
    });
    await reconcileVersionExperiments(api, {
      bundleId: 'com.acme.app',
      config: CONFIG,
      dryRun: false,
    });
    expect(calls.createdExperiments).toHaveLength(0); // experiment already exists
    expect(calls.createdTreatments).toEqual([{ experimentId: 'exp-1', name: 'Variant B' }]);
  });

  it('plans but performs nothing on a dry-run', async () => {
    const { api, calls } = makeApi({});
    const report = await reconcileVersionExperiments(api, {
      bundleId: 'com.acme.app',
      config: CONFIG,
      dryRun: true,
    });
    expect(calls.createdExperiments).toHaveLength(0);
    expect(calls.createdTreatments).toHaveLength(0);
    expect(report.actions.every((action) => action.status === 'planned')).toBe(true);
    expect(report.actions).toHaveLength(3); // experiment + 2 treatments
  });

  it('skips treatments when the experiment create failed', async () => {
    const { api } = makeApi({});
    api.createVersionExperiment = () => Promise.reject(new Error('name already in use'));
    const report = await reconcileVersionExperiments(api, {
      bundleId: 'com.acme.app',
      config: CONFIG,
      dryRun: false,
    });
    const summary = summarizeExperiments(report.actions);
    expect(summary).toEqual({ applied: 0, failed: 1, skipped: 2 }); // 1 failed experiment, 2 skipped treatments
    expect(report.actions.find((action) => action.status === 'failed')?.error).toBe(
      'name already in use',
    );
  });
});
