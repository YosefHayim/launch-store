import { previewBuild, type BuildPreviewInput } from '../build/buildPreview.ts';
import { checkConfigSemantics } from '../config/configSemantics.ts';
import { loadConfigSchema, validateConfig } from '../config/configSchema.ts';
import { findLaunchConfig, loadConfig } from '../config/config.ts';
import { buildDoctorContext } from '../doctor/context.ts';
import { inspectDoctor } from '../doctor/inspect.ts';
import { renderConfigDocs } from '../docs/configDocs.ts';
import { runPlanners } from '../plan/orchestrator.ts';
import { listSurfacePlanners, registerBuiltinPlanners } from '../plan/registry.ts';
import { runProbes } from '../readiness/orchestrator.ts';
import { registerBuiltinProbes, selectReadinessProbes } from '../readiness/registry.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { diffSnapshots } from '../snapshot/diff.ts';
import { captureSnapshot, type CaptureResult } from '../snapshot/orchestrator.ts';
import { listSnapshotSources, registerBuiltinSources } from '../snapshot/registry.ts';
import { listSnapshots, loadSnapshot, saveSnapshot } from '../snapshot/store.ts';
import { createAscClientResolver, createPlayClientResolver } from '../store/shared/storeClients.ts';
import { runSyncBatch } from '../store/shared/syncRun.ts';
import { buildJobs, selectApps } from '../store/shared/syncJobs.ts';
import type { McpTool, McpToolResult } from '../types/mcp.ts';
import type { SurfacePlanner } from '../types/plan.ts';
import type { ReadinessCategory } from '../types/readiness.ts';
import type { Snapshot } from '../types/snapshot.ts';

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

/** A tool argument or requested resource is invalid. */
export type McpToolFailure = Readonly<{
  _tag: 'McpToolFailure';
  message: string;
}>;

function makeMcpToolFailure(message: string): McpToolFailure {
  return { _tag: 'McpToolFailure', message };
}

/** Encode structured tool output as pretty-printed JSON text. */
export function jsonToolOutput(structuredOutput: unknown): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredOutput, null, 2) }],
  };
}

/** Read an optional string argument. */
export function optionalString(
  argumentsRecord: Record<string, unknown>,
  argumentName: string,
): string | undefined {
  const argumentValue = argumentsRecord[argumentName];

  if (typeof argumentValue == 'string') {
    return argumentValue;
  }

  return undefined;
}

/** Fail when a required string argument is absent. */
export function requiredString(
  argumentsRecord: Record<string, unknown>,
  argumentName: string,
): string {
  const argumentValue = optionalString(argumentsRecord, argumentName);

  if (argumentValue != null) {
    return argumentValue;
  }

  throw makeMcpToolFailure(`\`${argumentName}\` is required.`);
}

/** Read an optional platform argument, defaulting to iOS. */
export function requestedPlatform(argumentsRecord: Record<string, unknown>): 'ios' | 'android' {
  const platformArgument = optionalString(argumentsRecord, 'platform');

  if (platformArgument == null) {
    return 'ios';
  }

  if (platformArgument == 'ios') {
    return 'ios';
  }

  if (platformArgument == 'android') {
    return 'android';
  }

  throw makeMcpToolFailure(`Unknown platform "${platformArgument}". Use "ios" or "android".`);
}

function plannerId(planner: SurfacePlanner): string {
  return planner.id;
}

/** Restrict registered planners to one surface id, or keep every planner. */
export function chooseSurfacePlanners(
  registeredPlanners: readonly SurfacePlanner[],
  requestedSurface: string | undefined,
): SurfacePlanner[] {
  if (requestedSurface == null) {
    return [...registeredPlanners];
  }

  function isRequestedSurface(planner: SurfacePlanner): boolean {
    return planner.id == requestedSurface;
  }

  const matchingPlanner = registeredPlanners.find(isRequestedSurface);

  if (matchingPlanner != null) {
    return [matchingPlanner];
  }

  let availableSurfaces = registeredPlanners.map(plannerId).join(', ');
  const hasNoSurfaces = availableSurfaces.length == 0;

  if (hasNoSurfaces) {
    availableSurfaces = 'none';
  }

  throw makeMcpToolFailure(
    `Unknown surface "${requestedSurface}". Available: ${availableSurfaces}.`,
  );
}

function summarizeSnapshot(snapshot: Snapshot): {
  name: string;
  capturedAt: string;
  reports: number;
} {
  return {
    name: snapshot.name,
    capturedAt: snapshot.capturedAt,
    reports: snapshot.reports.length,
  };
}

/** Compact list rows for the snapshot_list tool. */
export function summarizeSnapshots(snapshots: readonly Snapshot[]): ReadonlyArray<{
  name: string;
  capturedAt: string;
  reports: number;
}> {
  return snapshots.map(summarizeSnapshot);
}

/** Load config, selected apps, and store clients once for plan/readiness/snapshot tools. */
async function loadStoreContext(appSelector: string | undefined) {
  const launchDirectories = readLaunchDirectories();
  const loadedConfiguration = await loadConfig(launchDirectories.workingDirectory);
  const selectedApps = await selectApps(loadedConfiguration.apps, appSelector);
  const resolveAscClient = createAscClientResolver();
  const ascClient = await resolveAscClient();
  const resolvePlayClient = createPlayClientResolver();

  async function resolveAscApi() {
    return ascClient;
  }

  return {
    config: loadedConfiguration.config,
    apps: selectedApps,
    resolveAscApi,
    resolvePlayApi: resolvePlayClient,
  };
}

/** Fail when a named snapshot is missing from disk. */
async function requireStoredSnapshot(snapshotName: string): Promise<Snapshot> {
  const storedSnapshot = await loadSnapshot(snapshotName);

  if (storedSnapshot != null) {
    return storedSnapshot;
  }

  throw makeMcpToolFailure(`No snapshot named "${snapshotName}".`);
}

/** Run the plan or drift tool. */
async function runPlanTool(
  argumentsRecord: Record<string, unknown>,
  check: boolean,
): Promise<McpToolResult> {
  registerBuiltinPlanners();
  const selectedPlanners = chooseSurfacePlanners(
    listSurfacePlanners(),
    optionalString(argumentsRecord, 'surface'),
  );
  const storeContext = await loadStoreContext(optionalString(argumentsRecord, 'app'));
  const planOutcome = await runPlanners(storeContext, selectedPlanners, { check });

  return jsonToolOutput(planOutcome);
}

/** Run one readiness category. */
async function runReadinessTool(
  argumentsRecord: Record<string, unknown>,
  category: ReadinessCategory,
): Promise<McpToolResult> {
  registerBuiltinProbes();
  const storeContext = await loadStoreContext(optionalString(argumentsRecord, 'app'));
  const readinessOutcome = await runProbes(storeContext, selectReadinessProbes(category));

  return jsonToolOutput(readinessOutcome);
}

/** Capture current store state for snapshot tools. */
async function captureLiveSnapshot(appSelector: string | undefined): Promise<CaptureResult> {
  registerBuiltinSources();
  const storeContext = await loadStoreContext(appSelector);
  const epochMilliseconds = Date.now();
  const capturedAt = new Date(epochMilliseconds).toISOString();

  return captureSnapshot(storeContext, listSnapshotSources(), {
    name: LIVE_SNAPSHOT_NAME,
    capturedAt,
  });
}

/** Run the local doctor tool. */
async function runDoctorTool(argumentsRecord: Record<string, unknown>): Promise<McpToolResult> {
  const platform = requestedPlatform(argumentsRecord);
  const doctorContext = await buildDoctorContext(platform, optionalString(argumentsRecord, 'app'));
  const doctorReport = await inspectDoctor(doctorContext);

  return jsonToolOutput(doctorReport);
}

/** Preview the resolved build without invoking a toolchain. */
async function runBuildPlanTool(argumentsRecord: Record<string, unknown>): Promise<McpToolResult> {
  const platform = requestedPlatform(argumentsRecord);
  const launchDirectories = readLaunchDirectories();
  const loadedConfiguration = await loadConfig(launchDirectories.workingDirectory);
  const selectedApps = await selectApps(
    loadedConfiguration.apps,
    optionalString(argumentsRecord, 'app'),
  );
  const profile = optionalString(argumentsRecord, 'profile');
  const distribution = optionalString(argumentsRecord, 'distribution');
  let previewInput: BuildPreviewInput = {
    config: loadedConfiguration.config,
    apps: selectedApps,
    platform,
  };

  if (profile != null) {
    previewInput = { ...previewInput, profile };
  }

  if (distribution != null) {
    previewInput = { ...previewInput, distribution };
  }

  const buildPreview = previewBuild(previewInput);

  return jsonToolOutput(buildPreview);
}

/** Apply additive or destructive store reconciliation headlessly. */
async function runSyncTool(
  argumentsRecord: Record<string, unknown>,
  allowDestructive: boolean,
): Promise<McpToolResult> {
  const storeContext = await loadStoreContext(optionalString(argumentsRecord, 'app'));
  const syncJobs = await buildJobs(storeContext.apps, storeContext.config);
  const hasNoJobs = syncJobs.length == 0;

  if (hasNoJobs) {
    return jsonToolOutput(EMPTY_SYNC_REPORT);
  }

  const appleClient = await storeContext.resolveAscApi();

  if (appleClient == null) {
    throw makeMcpToolFailure('No active Apple account. Run `launch creds set-key` first.');
  }

  const syncReport = await runSyncBatch(appleClient, syncJobs, allowDestructive);

  return jsonToolOutput(syncReport);
}

/** List persisted snapshot summaries. */
async function listSnapshotTool(): Promise<McpToolResult> {
  const snapshots = await listSnapshots();

  return jsonToolOutput(summarizeSnapshots(snapshots));
}

/** Diff one persisted snapshot against another or current store state. */
async function diffSnapshotTool(argumentsRecord: Record<string, unknown>): Promise<McpToolResult> {
  const baselineName = requiredString(argumentsRecord, 'baseline');
  const baselineSnapshot = await requireStoredSnapshot(baselineName);
  let comparisonName = optionalString(argumentsRecord, 'against');

  if (comparisonName == null) {
    comparisonName = LIVE_SNAPSHOT_NAME;
  }

  const isLiveComparison = comparisonName == LIVE_SNAPSHOT_NAME;

  if (isLiveComparison) {
    const liveCapture = await captureLiveSnapshot(optionalString(argumentsRecord, 'app'));

    return jsonToolOutput(diffSnapshots(baselineSnapshot, liveCapture.snapshot));
  }

  const comparisonSnapshot = await requireStoredSnapshot(comparisonName);

  return jsonToolOutput(diffSnapshots(baselineSnapshot, comparisonSnapshot));
}

/** Export a saved snapshot or capture and save a new one first. */
async function exportSnapshotTool(
  argumentsRecord: Record<string, unknown>,
): Promise<McpToolResult> {
  const snapshotName = requiredString(argumentsRecord, 'name');
  const shouldCapture = argumentsRecord['capture'] == true;

  if (shouldCapture) {
    const liveCapture = await captureLiveSnapshot(optionalString(argumentsRecord, 'app'));
    const namedSnapshot = { ...liveCapture.snapshot, name: snapshotName };
    const snapshotFilePath = await saveSnapshot(namedSnapshot);

    return jsonToolOutput({ ...liveCapture, snapshot: namedSnapshot, file: snapshotFilePath });
  }

  const storedSnapshot = await requireStoredSnapshot(snapshotName);

  return jsonToolOutput(storedSnapshot);
}

/** Validate launch.config shape and cross-field semantics. */
async function validateConfigTool(): Promise<McpToolResult> {
  const launchDirectories = readLaunchDirectories();
  const foundConfig = await findLaunchConfig(launchDirectories.workingDirectory);

  if (foundConfig == null) {
    throw makeMcpToolFailure('No launch.config file here. Run `launch init` first.');
  }

  const violations = validateConfig(foundConfig.config);
  const semanticChecks = checkConfigSemantics(foundConfig.config);
  const isValid = violations.length == 0;

  return jsonToolOutput({
    path: foundConfig.path,
    valid: isValid,
    violations,
    semantic: semanticChecks,
  });
}

/** Return the launch.config field reference as Markdown. */
async function configDocsTool(): Promise<McpToolResult> {
  const configSchema = loadConfigSchema();
  const markdown = renderConfigDocs(configSchema);

  return jsonToolOutput({ markdown });
}

async function showConfigSchema(): Promise<McpToolResult> {
  const configSchema = loadConfigSchema();

  return jsonToolOutput(configSchema);
}

async function planTool(argumentsRecord: Record<string, unknown>): Promise<McpToolResult> {
  return runPlanTool(argumentsRecord, false);
}

async function driftTool(argumentsRecord: Record<string, unknown>): Promise<McpToolResult> {
  return runPlanTool(argumentsRecord, true);
}

async function auditTool(argumentsRecord: Record<string, unknown>): Promise<McpToolResult> {
  return runReadinessTool(argumentsRecord, 'submit');
}

async function storeDoctorTool(argumentsRecord: Record<string, unknown>): Promise<McpToolResult> {
  return runReadinessTool(argumentsRecord, 'account');
}

async function iapDoctorTool(argumentsRecord: Record<string, unknown>): Promise<McpToolResult> {
  return runReadinessTool(argumentsRecord, 'iap');
}

async function syncTool(argumentsRecord: Record<string, unknown>): Promise<McpToolResult> {
  return runSyncTool(argumentsRecord, false);
}

async function syncDestructiveTool(
  argumentsRecord: Record<string, unknown>,
): Promise<McpToolResult> {
  return runSyncTool(argumentsRecord, true);
}

export const READ_TOOLS: readonly McpTool[] = [
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
    handler: planTool,
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
    handler: driftTool,
  },
  {
    name: 'audit',
    description: 'Run the pre-submit readiness sweep.',
    capability: 'read',
    inputSchema: APP_FILTER_SCHEMA,
    handler: auditTool,
  },
  {
    name: 'store_doctor',
    description: 'Check store-account readiness and app access.',
    capability: 'read',
    inputSchema: APP_FILTER_SCHEMA,
    handler: storeDoctorTool,
  },
  {
    name: 'iap_doctor',
    description: 'Check in-app-purchase and subscription readiness.',
    capability: 'read',
    inputSchema: APP_FILTER_SCHEMA,
    handler: iapDoctorTool,
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
    handler: showConfigSchema,
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

export const DRY_RUN_TOOLS: readonly McpTool[] = [
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

export const WRITE_TOOLS: readonly McpTool[] = [
  {
    name: 'sync',
    description: 'Apply additive launch.config changes to App Store Connect.',
    capability: 'write',
    inputSchema: APP_FILTER_SCHEMA,
    handler: syncTool,
  },
];

export const DANGEROUS_TOOLS: readonly McpTool[] = [
  {
    name: 'sync_destructive',
    description: 'Apply launch.config changes including destructive removals.',
    capability: 'dangerous',
    inputSchema: APP_FILTER_SCHEMA,
    handler: syncDestructiveTool,
  },
];

export const ALL_TOOLS: readonly McpTool[] = [
  ...READ_TOOLS,
  ...DRY_RUN_TOOLS,
  ...WRITE_TOOLS,
  ...DANGEROUS_TOOLS,
];
