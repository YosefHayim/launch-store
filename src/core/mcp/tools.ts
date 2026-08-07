import type { HttpClient } from '@effect/platform';
import { Clock, Data, Effect } from 'effect';
import { previewBuild, type BuildPreviewInput } from '../build/buildPreview.js';
import { checkConfigSemantics } from '../config/configSemantics.js';
import { loadConfigSchema, validateConfig } from '../config/configSchema.js';
import { findLaunchConfig, loadConfig } from '../config/config.js';
import { buildDoctorContext, type DoctorRuntimeRequirements } from '../doctor/context.js';
import { inspectDoctor } from '../doctor/inspect.js';
import { renderConfigDocs } from '../docs/configDocs.js';
import { runPlanners } from '../plan/orchestrator.js';
import { listSurfacePlanners, registerBuiltinPlanners } from '../plan/registry.js';
import { runProbes } from '../readiness/orchestrator.js';
import { registerBuiltinProbes, selectReadinessProbes } from '../readiness/registry.js';
import { LaunchPaths } from '../services/paths.js';
import { diffSnapshots } from '../snapshot/diff.js';
import { captureSnapshot, type CaptureResult } from '../snapshot/orchestrator.js';
import { listSnapshotSources, registerBuiltinSources } from '../snapshot/registry.js';
import { listSnapshots, loadSnapshot, saveSnapshot } from '../snapshot/store.js';
import { createAscClientResolver, createPlayClientResolver } from '../store/storeClients.js';
import { runSyncBatch } from '../store/syncRun.js';
import { buildJobs, selectApps } from '../store/syncJobs.js';
import type { Platform } from '../types/app.js';
import type { McpTool, McpToolResult } from '../types/mcp.js';
import type { PlanContext, SurfacePlanner } from '../types/plan.js';
import type { ReadinessCategory, ReadinessContext } from '../types/readiness.js';
import type { Snapshot, SnapshotContext } from '../types/snapshot.js';

const LIVE_SNAPSHOT_NAME = 'live';

const APP_FILTER_SCHEMA = {
  type: 'object',
  properties: {
    app: { type: 'string', description: 'comma-separated app handles (default: all apps)' },
  },
} as const;

const EMPTY_SYNC_REPORT = {
  apps: [],
  summary: { apps: 0, applied: 0, failed: 0, skipped: 0, planErrors: 0 },
} as const;

export type McpToolRequirements = DoctorRuntimeRequirements | HttpClient.HttpClient;

/** A tool argument or requested resource is invalid. */
export type McpToolFailure = Readonly<{
  readonly _tag: 'McpToolFailure';
  readonly message: string;
}>;

export const makeMcpToolFailure = Data.tagged<McpToolFailure>('McpToolFailure');

/** Encode structured tool output as pretty-printed JSON text. */
export const jsonToolOutput = (structuredOutput: unknown): McpToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(structuredOutput, null, 2) }],
});

/** Read an optional string argument. */
export const optionalString = (
  argumentsRecord: Record<string, unknown>,
  argumentName: string,
): string | undefined => {
  const argumentValue = argumentsRecord[argumentName];
  if (typeof argumentValue === 'string') return argumentValue;
  return undefined;
};

/** Fail when a required string argument is absent. */
export const requiredString = (
  argumentsRecord: Record<string, unknown>,
  argumentName: string,
): Effect.Effect<string, McpToolFailure> => {
  const argumentValue = optionalString(argumentsRecord, argumentName);
  if (argumentValue !== undefined) return Effect.succeed(argumentValue);
  return Effect.fail(makeMcpToolFailure({ message: `\`${argumentName}\` is required.` }));
};

/** Read an optional platform argument, defaulting to iOS. */
export const requestedPlatform = (
  argumentsRecord: Record<string, unknown>,
): Effect.Effect<'ios' | 'android', McpToolFailure> => {
  const platformArgument = optionalString(argumentsRecord, 'platform');
  if (platformArgument === undefined) return Effect.succeed('ios');
  if (platformArgument === 'ios') return Effect.succeed('ios');
  if (platformArgument === 'android') return Effect.succeed('android');
  return Effect.fail(
    makeMcpToolFailure({
      message: `Unknown platform "${platformArgument}". Use "ios" or "android".`,
    }),
  );
};

/** Restrict registered planners to one surface id, or keep every planner. */
export const chooseSurfacePlanners = (
  registeredPlanners: readonly SurfacePlanner[],
  requestedSurface: string | undefined,
): Effect.Effect<SurfacePlanner[], McpToolFailure> => {
  if (requestedSurface === undefined) return Effect.succeed([...registeredPlanners]);
  const matchingPlanner = registeredPlanners.find((planner) => planner.id === requestedSurface);
  if (matchingPlanner !== undefined) return Effect.succeed([matchingPlanner]);
  let availableSurfaces = registeredPlanners.map((planner) => planner.id).join(', ');
  if (availableSurfaces.length === 0) availableSurfaces = 'none';
  return Effect.fail(
    makeMcpToolFailure({
      message: `Unknown surface "${requestedSurface}". Available: ${availableSurfaces}.`,
    }),
  );
};

/** Compact list rows for the snapshot_list tool. */
export const summarizeSnapshots = (
  snapshots: readonly Snapshot[],
): ReadonlyArray<{
  readonly name: string;
  readonly capturedAt: string;
  readonly reports: number;
}> =>
  snapshots.map((snapshot) => ({
    name: snapshot.name,
    capturedAt: snapshot.capturedAt,
    reports: snapshot.reports.length,
  }));

/** Load config, selected apps, and store clients once for plan/readiness/snapshot tools. */
const loadStoreContext = (
  appSelector: string | undefined,
): Effect.Effect<PlanContext & ReadinessContext & SnapshotContext, unknown, McpToolRequirements> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const loadedConfig = yield* loadConfig(launchPaths.workingDirectory);
    const selectedApps = yield* selectApps(loadedConfig.apps, appSelector);
    const appleClient = yield* createAscClientResolver()();
    const googleClient = yield* createPlayClientResolver()();
    return {
      config: loadedConfig.config,
      apps: selectedApps,
      resolveAscApi: () => Effect.succeed(appleClient),
      resolvePlayApi: () => Effect.succeed(googleClient),
    };
  });

/** Fail when a named snapshot is missing from disk. */
const requireStoredSnapshot = (
  snapshotName: string,
): Effect.Effect<Snapshot, McpToolFailure, McpToolRequirements> =>
  Effect.gen(function* () {
    const storedSnapshot = yield* loadSnapshot(snapshotName);
    if (storedSnapshot !== null) return storedSnapshot;
    return yield* Effect.fail(
      makeMcpToolFailure({
        message: `No snapshot named "${snapshotName}".`,
      }),
    );
  });

/** Run the plan or drift tool. */
const runPlanTool = (
  argumentsRecord: Record<string, unknown>,
  check: boolean,
): Effect.Effect<McpToolResult, unknown, McpToolRequirements> =>
  Effect.gen(function* () {
    registerBuiltinPlanners();
    const selectedPlanners = yield* chooseSurfacePlanners(
      listSurfacePlanners(),
      optionalString(argumentsRecord, 'surface'),
    );
    const storeContext = yield* loadStoreContext(optionalString(argumentsRecord, 'app'));
    const planOutcome = yield* runPlanners(storeContext, selectedPlanners, { check });
    return jsonToolOutput(planOutcome);
  });

/** Run one readiness category. */
const runReadinessTool = (
  argumentsRecord: Record<string, unknown>,
  category: ReadinessCategory,
): Effect.Effect<McpToolResult, unknown, McpToolRequirements> =>
  Effect.gen(function* () {
    registerBuiltinProbes();
    const storeContext = yield* loadStoreContext(optionalString(argumentsRecord, 'app'));
    const readinessOutcome = yield* runProbes(storeContext, selectReadinessProbes(category));
    return jsonToolOutput(readinessOutcome);
  });

/** Capture current store state for snapshot tools. */
const captureLiveSnapshot = (
  appSelector: string | undefined,
): Effect.Effect<CaptureResult, unknown, McpToolRequirements> =>
  Effect.gen(function* () {
    registerBuiltinSources();
    const storeContext = yield* loadStoreContext(appSelector);
    const epochMilliseconds = yield* Clock.currentTimeMillis;
    return yield* captureSnapshot(storeContext, listSnapshotSources(), {
      name: LIVE_SNAPSHOT_NAME,
      capturedAt: new Date(epochMilliseconds).toISOString(),
    });
  });

/** Run the local doctor tool. */
const runDoctorTool = (
  argumentsRecord: Record<string, unknown>,
): Effect.Effect<McpToolResult, unknown, McpToolRequirements> =>
  Effect.gen(function* () {
    const platform = yield* requestedPlatform(argumentsRecord);
    const doctorContext = yield* buildDoctorContext(
      platform,
      optionalString(argumentsRecord, 'app'),
    );
    const doctorReport = yield* inspectDoctor(doctorContext);
    return jsonToolOutput(doctorReport);
  });

/** Preview the resolved build without invoking a toolchain. */
const runBuildPlanTool = (
  argumentsRecord: Record<string, unknown>,
): Effect.Effect<McpToolResult, unknown, McpToolRequirements> =>
  Effect.gen(function* () {
    const platform: Platform = yield* requestedPlatform(argumentsRecord);
    const launchPaths = yield* LaunchPaths;
    const loadedConfig = yield* loadConfig(launchPaths.workingDirectory);
    const selectedApps = yield* selectApps(
      loadedConfig.apps,
      optionalString(argumentsRecord, 'app'),
    );
    let previewInput: BuildPreviewInput = {
      config: loadedConfig.config,
      apps: selectedApps,
      platform,
    };
    const profile = optionalString(argumentsRecord, 'profile');
    const distribution = optionalString(argumentsRecord, 'distribution');
    if (profile !== undefined) previewInput = { ...previewInput, profile };
    if (distribution !== undefined) previewInput = { ...previewInput, distribution };
    const buildPreview = yield* previewBuild(previewInput);
    return jsonToolOutput(buildPreview);
  });

/** Apply additive or destructive store reconciliation headlessly. */
const runSyncTool = (
  argumentsRecord: Record<string, unknown>,
  allowDestructive: boolean,
): Effect.Effect<McpToolResult, unknown, McpToolRequirements> =>
  Effect.gen(function* () {
    const storeContext = yield* loadStoreContext(optionalString(argumentsRecord, 'app'));
    const syncJobs = yield* buildJobs(storeContext.apps, storeContext.config);
    if (syncJobs.length === 0) return jsonToolOutput(EMPTY_SYNC_REPORT);
    const appleClient = yield* storeContext.resolveAscApi();
    if (appleClient === null) {
      return yield* Effect.fail(
        makeMcpToolFailure({
          message: 'No active Apple account. Run `launch creds set-key` first.',
        }),
      );
    }
    const syncReport = yield* runSyncBatch(appleClient, syncJobs, allowDestructive);
    return jsonToolOutput(syncReport);
  });

/** List persisted snapshot summaries. */
const listSnapshotTool = (): Effect.Effect<McpToolResult, never, McpToolRequirements> =>
  Effect.gen(function* () {
    const snapshots = yield* listSnapshots();
    return jsonToolOutput(summarizeSnapshots(snapshots));
  });

/** Diff one persisted snapshot against another or current store state. */
const diffSnapshotTool = (
  argumentsRecord: Record<string, unknown>,
): Effect.Effect<McpToolResult, unknown, McpToolRequirements> =>
  Effect.gen(function* () {
    const baselineName = yield* requiredString(argumentsRecord, 'baseline');
    const baselineSnapshot = yield* requireStoredSnapshot(baselineName);
    let comparisonName = optionalString(argumentsRecord, 'against');
    if (comparisonName === undefined) comparisonName = LIVE_SNAPSHOT_NAME;
    let comparisonSnapshot: Snapshot;
    if (comparisonName === LIVE_SNAPSHOT_NAME) {
      const liveCapture = yield* captureLiveSnapshot(optionalString(argumentsRecord, 'app'));
      comparisonSnapshot = liveCapture.snapshot;
    } else {
      comparisonSnapshot = yield* requireStoredSnapshot(comparisonName);
    }
    return jsonToolOutput(diffSnapshots(baselineSnapshot, comparisonSnapshot));
  });

/** Export a saved snapshot or capture and save a new one first. */
const exportSnapshotTool = (
  argumentsRecord: Record<string, unknown>,
): Effect.Effect<McpToolResult, unknown, McpToolRequirements> =>
  Effect.gen(function* () {
    const snapshotName = yield* requiredString(argumentsRecord, 'name');
    if (argumentsRecord['capture'] === true) {
      const liveCapture = yield* captureLiveSnapshot(optionalString(argumentsRecord, 'app'));
      const namedSnapshot = { ...liveCapture.snapshot, name: snapshotName };
      const snapshotFilePath = yield* saveSnapshot(namedSnapshot);
      return jsonToolOutput({ ...liveCapture, snapshot: namedSnapshot, file: snapshotFilePath });
    }
    const storedSnapshot = yield* requireStoredSnapshot(snapshotName);
    return jsonToolOutput(storedSnapshot);
  });

/** Validate launch.config shape and cross-field semantics. */
const validateConfigTool = (): Effect.Effect<McpToolResult, unknown, McpToolRequirements> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const foundConfig = yield* findLaunchConfig(launchPaths.workingDirectory);
    if (foundConfig === null) {
      return yield* Effect.fail(
        makeMcpToolFailure({
          message: 'No launch.config file here. Run `launch init` first.',
        }),
      );
    }
    const violations = validateConfig(foundConfig.config);
    const semanticChecks = checkConfigSemantics(foundConfig.config);
    return jsonToolOutput({
      path: foundConfig.path,
      valid: violations.length === 0,
      violations,
      semantic: semanticChecks,
    });
  });

/** Return the launch.config field reference as Markdown. */
const configDocsTool = (): Effect.Effect<McpToolResult, unknown, McpToolRequirements> =>
  Effect.gen(function* () {
    const configSchema = yield* loadConfigSchema();
    return jsonToolOutput({ markdown: renderConfigDocs(configSchema) });
  });

export const READ_TOOLS: readonly McpTool<McpToolRequirements>[] = [
  {
    name: 'plan',
    description: 'Diff launch.config against live store state (read-only).',
    capability: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        surface: { type: 'string', description: 'restrict to one surface id' },
        app: { type: 'string', description: 'comma-separated app handles' },
      },
    },
    handler: (argumentsRecord) => runPlanTool(argumentsRecord, false),
  },
  {
    name: 'drift',
    description: 'Grade store drift against launch.config as a read-only gate.',
    capability: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        surface: { type: 'string', description: 'restrict to one surface id' },
        app: { type: 'string', description: 'comma-separated app handles' },
      },
    },
    handler: (argumentsRecord) => runPlanTool(argumentsRecord, true),
  },
  {
    name: 'audit',
    description: 'Run the pre-submit readiness sweep.',
    capability: 'read',
    inputSchema: APP_FILTER_SCHEMA,
    handler: (argumentsRecord) => runReadinessTool(argumentsRecord, 'submit'),
  },
  {
    name: 'store_doctor',
    description: 'Check store-account readiness and app access.',
    capability: 'read',
    inputSchema: APP_FILTER_SCHEMA,
    handler: (argumentsRecord) => runReadinessTool(argumentsRecord, 'account'),
  },
  {
    name: 'iap_doctor',
    description: 'Check in-app-purchase and subscription readiness.',
    capability: 'read',
    inputSchema: APP_FILTER_SCHEMA,
    handler: (argumentsRecord) => runReadinessTool(argumentsRecord, 'iap'),
  },
  {
    name: 'config_validate',
    description: 'Validate launch.config shape and cross-field semantics.',
    capability: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: validateConfigTool,
  },
  {
    name: 'config_schema',
    description: 'Return the JSON Schema for launch.config.',
    capability: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: () => loadConfigSchema().pipe(Effect.map(jsonToolOutput)),
  },
  {
    name: 'config_docs',
    description: 'Return the launch.config field reference as Markdown.',
    capability: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: configDocsTool,
  },
  {
    name: 'snapshot_list',
    description: 'List saved store-state snapshots, newest first.',
    capability: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: listSnapshotTool,
  },
  {
    name: 'snapshot_diff',
    description: 'Compare a saved snapshot against another snapshot or live state.',
    capability: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        baseline: { type: 'string', description: 'saved baseline snapshot' },
        against: { type: 'string', description: 'saved snapshot or live' },
        app: { type: 'string', description: 'comma-separated app handles' },
      },
      required: ['baseline'],
    },
    handler: diffSnapshotTool,
  },
  {
    name: 'snapshot_export',
    description: 'Export a saved snapshot or capture and save a new one.',
    capability: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'snapshot name' },
        capture: { type: 'boolean', description: 'capture live state first' },
        app: { type: 'string', description: 'comma-separated app handles' },
      },
      required: ['name'],
    },
    handler: exportSnapshotTool,
  },
  {
    name: 'doctor',
    description: 'Run local toolchain and store-account preflight.',
    capability: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['ios', 'android'] },
        app: { type: 'string', description: 'comma-separated app handles' },
      },
    },
    handler: runDoctorTool,
  },
];

export const DRY_RUN_TOOLS: readonly McpTool<McpToolRequirements>[] = [
  {
    name: 'build_plan',
    description: 'Preview resolved build choices without invoking the toolchain.',
    capability: 'dryRun',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['ios', 'android'] },
        app: { type: 'string', description: 'comma-separated app handles' },
        profile: { type: 'string', description: 'build profile' },
        distribution: { type: 'string', enum: ['store', 'internal'] },
      },
    },
    handler: runBuildPlanTool,
  },
];

export const WRITE_TOOLS: readonly McpTool<McpToolRequirements>[] = [
  {
    name: 'sync',
    description: 'Apply additive launch.config changes to App Store Connect.',
    capability: 'write',
    inputSchema: APP_FILTER_SCHEMA,
    handler: (argumentsRecord) => runSyncTool(argumentsRecord, false),
  },
];

export const DANGEROUS_TOOLS: readonly McpTool<McpToolRequirements>[] = [
  {
    name: 'sync_destructive',
    description: 'Apply launch.config changes including destructive removals.',
    capability: 'dangerous',
    inputSchema: APP_FILTER_SCHEMA,
    handler: (argumentsRecord) => runSyncTool(argumentsRecord, true),
  },
];

export const ALL_TOOLS: readonly McpTool<McpToolRequirements>[] = [
  ...READ_TOOLS,
  ...DRY_RUN_TOOLS,
  ...WRITE_TOOLS,
  ...DANGEROUS_TOOLS,
];
