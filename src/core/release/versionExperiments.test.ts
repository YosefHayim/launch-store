import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type {
  ExperimentTreatmentResource,
  VersionExperimentResource,
} from '../types/appleCatalog.js';
import {
  type AscExperimentsApi,
  loadVersionExperimentsConfig,
  parseVersionExperimentsConfig,
  reconcileVersionExperiments,
  summarizeExperiments,
  type VersionExperimentsConfig,
} from './versionExperiments.js';

type ExperimentWrites = {
  createdExperiments: Array<{
    name: string;
    platform: string;
    trafficProportion: number;
  }>;
  createdTreatments: Array<{ experimentId: string; name: string }>;
};

type ExperimentStoreState = {
  appId: string | null;
  experiments: VersionExperimentResource[];
  treatments: ExperimentTreatmentResource[];
};

/** Build an Effect-native experiments API fake and its write journal. */
const makeExperimentsApi = (
  stateOverrides: Partial<ExperimentStoreState>,
  methodOverrides: Partial<AscExperimentsApi> = {},
): Readonly<{ appleExperimentsApi: AscExperimentsApi; experimentWrites: ExperimentWrites }> => {
  const experimentStore: ExperimentStoreState = {
    appId: 'app-1',
    experiments: [],
    treatments: [],
    ...stateOverrides,
  };
  const experimentWrites: ExperimentWrites = {
    createdExperiments: [],
    createdTreatments: [],
  };
  const appleExperimentsApi: AscExperimentsApi = {
    getAppId: () => Effect.succeed(experimentStore.appId),
    listVersionExperiments: () => Effect.succeed(experimentStore.experiments),
    createVersionExperiment: (_appId, experimentInput) => {
      experimentWrites.createdExperiments.push(experimentInput);
      return Effect.succeed({
        id: 'exp-new',
        name: experimentInput.name,
        state: 'PREPARE_FOR_SUBMISSION',
      });
    },
    listExperimentTreatments: () => Effect.succeed(experimentStore.treatments),
    createExperimentTreatment: (experimentId, treatmentInput) => {
      experimentWrites.createdTreatments.push({
        experimentId,
        name: treatmentInput.name,
      });
      return Effect.succeed({ id: 'treat-new', name: treatmentInput.name });
    },
    ...methodOverrides,
  };
  return { appleExperimentsApi, experimentWrites };
};

const experimentConfig: VersionExperimentsConfig = {
  experiments: [
    {
      name: 'Icon Test',
      trafficProportion: 50,
      treatments: [{ name: 'Variant A' }, { name: 'Variant B' }],
    },
  ],
};

/** Run the shared experiment fixture in plan or apply mode. */
const reconcileExperiments = (appleExperimentsApi: AscExperimentsApi, dryRun: boolean) =>
  Effect.runPromise(
    reconcileVersionExperiments(appleExperimentsApi, {
      bundleId: 'com.acme.app',
      config: experimentConfig,
      dryRun,
    }),
  );

describe('version experiments schema', () => {
  it('decodes experiments with treatments', async () => {
    const decodedConfig = await Effect.runPromise(parseVersionExperimentsConfig(experimentConfig));
    expect(decodedConfig.experiments[0]?.name).toBe('Icon Test');
    expect(
      decodedConfig.experiments[0]?.treatments?.map((declaredTreatment) => declaredTreatment.name),
    ).toEqual(['Variant A', 'Variant B']);
  });

  it('rejects malformed documents and duplicate names', async () => {
    await expect(Effect.runPromise(parseVersionExperimentsConfig('nope'))).rejects.toThrow(
      /must be a JSON object/,
    );
    await expect(
      Effect.runPromise(parseVersionExperimentsConfig({ experiments: [] })),
    ).rejects.toThrow(/at least one entry/);
    await expect(
      Effect.runPromise(
        parseVersionExperimentsConfig({
          experiments: [{ name: 'X', trafficProportion: 0 }],
        }),
      ),
    ).rejects.toThrow(/trafficProportion must be a positive number/);
    await expect(
      Effect.runPromise(
        parseVersionExperimentsConfig({
          experiments: [
            { name: 'X', trafficProportion: 10 },
            { name: 'X', trafficProportion: 20 },
          ],
        }),
      ),
    ).rejects.toThrow(/duplicate experiment name/);
  });

  it('reads and decodes a sidecar through Effect Platform', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'launch-experiments-'));
    const configPath = join(temporaryDirectory, 'experiments.config.json');
    try {
      writeFileSync(configPath, JSON.stringify(experimentConfig));
      const loadedConfig = await Effect.runPromise(
        loadVersionExperimentsConfig(configPath).pipe(Effect.provide(NodeContext.layer)),
      );
      expect(loadedConfig).toEqual(experimentConfig);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

describe('version experiment reconciliation', () => {
  it('fails when the App Store record is absent', async () => {
    const { appleExperimentsApi } = makeExperimentsApi({ appId: null });
    await expect(reconcileExperiments(appleExperimentsApi, true)).rejects.toThrow(
      /No App Store Connect app record/,
    );
  });

  it('creates a missing experiment and its treatments', async () => {
    const { appleExperimentsApi, experimentWrites } = makeExperimentsApi({});
    const reconciliationReport = await reconcileExperiments(appleExperimentsApi, false);
    expect(experimentWrites.createdExperiments).toEqual([
      { name: 'Icon Test', platform: 'IOS', trafficProportion: 50 },
    ]);
    expect(experimentWrites.createdTreatments).toEqual([
      { experimentId: 'exp-new', name: 'Variant A' },
      { experimentId: 'exp-new', name: 'Variant B' },
    ]);
    expect(summarizeExperiments(reconciliationReport.actions)).toEqual({
      applied: 3,
      failed: 0,
      skipped: 0,
    });
  });

  it('creates only missing treatments on an existing experiment', async () => {
    const { appleExperimentsApi, experimentWrites } = makeExperimentsApi({
      experiments: [{ id: 'exp-1', name: 'Icon Test', state: 'PREPARE_FOR_SUBMISSION' }],
      treatments: [{ id: 't-a', name: 'Variant A' }],
    });
    await reconcileExperiments(appleExperimentsApi, false);
    expect(experimentWrites.createdExperiments).toHaveLength(0);
    expect(experimentWrites.createdTreatments).toEqual([
      { experimentId: 'exp-1', name: 'Variant B' },
    ]);
  });

  it('plans without applying writes', async () => {
    const { appleExperimentsApi, experimentWrites } = makeExperimentsApi({});
    const reconciliationReport = await reconcileExperiments(appleExperimentsApi, true);
    expect(experimentWrites.createdExperiments).toHaveLength(0);
    expect(experimentWrites.createdTreatments).toHaveLength(0);
    expect(
      reconciliationReport.actions.every((plannedAction) => plannedAction.status === 'planned'),
    ).toBe(true);
    expect(reconciliationReport.actions).toHaveLength(3);
  });

  it('skips treatments when experiment creation fails', async () => {
    const { appleExperimentsApi } = makeExperimentsApi(
      {},
      {
        createVersionExperiment: () => Effect.fail(new Error('name already in use')),
      },
    );
    const reconciliationReport = await reconcileExperiments(appleExperimentsApi, false);
    expect(summarizeExperiments(reconciliationReport.actions)).toEqual({
      applied: 0,
      failed: 1,
      skipped: 2,
    });
    expect(
      reconciliationReport.actions.find((plannedAction) => plannedAction.status === 'failed')
        ?.error,
    ).toBe('name already in use');
  });
});
