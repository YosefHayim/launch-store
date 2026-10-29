import { Clock, Effect } from 'effect';
import { readArtifactIndex } from '../build/artifactRetention.js';
import { listSecretRefs, type SecretRef } from '../build/buildSecrets.js';
import { findLaunchConfig, loadConfig } from '../config/config.js';
import { getActiveAccount, listAccounts } from '../credentials/accounts.js';
import { getLiveHost } from '../distribution/cloudState.js';
import { LaunchPaths, resolveLaunchHomeDirectory } from '../services/paths.js';
import type { AppDescriptor } from '../types/app.js';
import type { BuildArtifact } from '../types/artifacts.js';
import type { LaunchConfig } from '../types/config.js';
import type { AccountRecord } from '../types/credentials.js';
import type {
  DashboardAccount,
  DashboardApp,
  DashboardArtifact,
  DashboardCloudHost,
  DashboardMode,
  DashboardState,
} from '../types/dashboard.js';
import type { HostHandle } from '../types/remote.js';

export const RECENT_ARTIFACT_LIMIT = 12;
const BYTES_PER_MB = 1024 * 1024;

export type DashboardInputs = Readonly<{
  readonly now: Date;
  readonly launchHome: string;
  readonly config: LaunchConfig | null;
  readonly apps: readonly AppDescriptor[];
  readonly accounts: readonly AccountRecord[];
  readonly activeKeyId: string | null;
  readonly artifacts: readonly BuildArtifact[];
  readonly secrets: readonly SecretRef[];
  readonly cloudHost: HostHandle | null;
}>;

const toSizeMB = (artifactBytes: number): number | null => {
  if (artifactBytes <= 0) return null;
  return Math.round((artifactBytes / BYTES_PER_MB) * 10) / 10;
};

const optionalText = (text: string | undefined): string | null => {
  if (text === undefined) return null;
  return text;
};

const toDashboardApp = (app: AppDescriptor): DashboardApp => ({
  name: app.name,
  version: optionalText(app.version),
  bundleId: optionalText(app.bundleId),
  packageName: optionalText(app.packageName),
});

const toDashboardAccount = (
  account: AccountRecord,
  activeKeyId: string | null,
): DashboardAccount => {
  let appCount = 0;
  if (account.apps !== undefined) appCount = account.apps.length;
  return {
    label: account.label,
    keyId: account.keyId,
    teamId: optionalText(account.teamId),
    appCount,
    active: account.keyId === activeKeyId,
  };
};

const toDashboardArtifact = (buildArtifact: BuildArtifact): DashboardArtifact => ({
  app: buildArtifact.appName,
  platform: buildArtifact.platform,
  version: buildArtifact.version,
  buildNumber: buildArtifact.buildNumber,
  createdAt: buildArtifact.createdAt,
  sizeMB: toSizeMB(buildArtifact.sizeReport.artifactBytes),
  pruned: buildArtifact.prunedAt !== undefined,
});

const toDashboardCloudHost = (host: HostHandle | null): DashboardCloudHost | null => {
  if (host === null) return null;
  return {
    provider: host.provider,
    region: optionalText(host.region),
    instanceType: optionalText(host.instanceType),
    instanceId: optionalText(host.instanceId),
    allocatedAt: host.allocatedAt,
  };
};

const formatSubmitProviders = (submitProviders: LaunchConfig['submit']): string => {
  if (typeof submitProviders === 'string') return submitProviders;
  return [...new Set(Object.values(submitProviders).flat())].join(', ');
};

const NO_PROJECT_APPS: readonly AppDescriptor[] = [];
const EMPTY_PROJECT_PROVIDERS = { credentials: '', storage: '', buildEngine: '', submit: '' };

const createDashboardProject = (
  config: LaunchConfig | null,
  apps: readonly AppDescriptor[],
): DashboardState['project'] => {
  if (config === null) {
    return { providers: EMPTY_PROJECT_PROVIDERS, profiles: [], apps: [] };
  }
  return {
    providers: {
      credentials: config.credentials,
      storage: config.storage,
      buildEngine: config.buildEngine,
      submit: formatSubmitProviders(config.submit),
    },
    profiles: Object.keys(config.profiles),
    apps: apps.map(toDashboardApp),
  };
};

const readDashboardMode = (config: LaunchConfig | null): DashboardMode => {
  if (config === null) return 'portfolio-only';
  return 'project';
};

/** Project already-read local state into the dashboard snapshot. */
export const buildDashboardState = (
  dashboardInputs: DashboardInputs,
): Effect.Effect<DashboardState> =>
  Effect.sync(() => ({
    mode: readDashboardMode(dashboardInputs.config),
    generatedAt: dashboardInputs.now.toISOString(),
    launchHome: dashboardInputs.launchHome,
    project: createDashboardProject(dashboardInputs.config, dashboardInputs.apps),
    accounts: dashboardInputs.accounts.map((account) =>
      toDashboardAccount(account, dashboardInputs.activeKeyId),
    ),
    artifacts: dashboardInputs.artifacts.slice(0, RECENT_ARTIFACT_LIMIT).map(toDashboardArtifact),
    secrets: dashboardInputs.secrets.map((secretReference) => ({
      app: secretReference.app,
      profile: secretReference.profile,
      name: secretReference.name,
    })),
    cloudHost: toDashboardCloudHost(dashboardInputs.cloudHost),
  }));

/** Read the project config and its apps, or nothing when this folder has no launch.config. */
const loadProjectSetup = (workingDirectory: string) =>
  Effect.gen(function* () {
    const launchConfigPath = yield* findLaunchConfig(workingDirectory);
    if (launchConfigPath === null) return { config: null, apps: NO_PROJECT_APPS };
    const projectSetup = yield* loadConfig(workingDirectory);
    return { config: projectSetup.config, apps: projectSetup.apps };
  });

/** Read local state and build a dashboard snapshot without making network calls. */
export const gatherDashboardState = (snapshotTime?: Date) =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const launchHome = yield* resolveLaunchHomeDirectory();
    let generatedAt = snapshotTime;
    if (generatedAt === undefined) {
      generatedAt = new Date(yield* Clock.currentTimeMillis);
    }
    const localDashboardState = yield* Effect.all(
      {
        projectConfig: loadProjectSetup(launchPaths.workingDirectory),
        accounts: listAccounts(),
        activeAccount: getActiveAccount(),
        artifacts: readArtifactIndex(),
        secrets: listSecretRefs(),
        cloudHost: getLiveHost(),
      },
      { concurrency: 'unbounded' },
    );
    let activeKeyId: string | null = null;
    if (localDashboardState.activeAccount !== null) {
      activeKeyId = localDashboardState.activeAccount.keyId;
    }
    return yield* buildDashboardState({
      now: generatedAt,
      launchHome,
      config: localDashboardState.projectConfig.config,
      apps: localDashboardState.projectConfig.apps,
      accounts: localDashboardState.accounts,
      activeKeyId,
      artifacts: localDashboardState.artifacts,
      secrets: localDashboardState.secrets,
      cloudHost: localDashboardState.cloudHost,
    });
  });
