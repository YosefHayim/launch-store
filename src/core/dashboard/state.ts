/**
 * Assemble the {@link DashboardState} the local dashboard renders.
 *
 * The split mirrors the codebase's pure-core / thin-shell pattern: {@link buildDashboardState} is a
 * **pure** projection from already-read domain shapes into the flat presentation snapshot (so every
 * rule — the recent-artifact cap, the active-account flag, dropping secret values — is unit-tested
 * without touching disk), and {@link gatherDashboardState} is the thin reader that pulls the raw state
 * from the existing helpers and hands it to the pure builder. No network or App Store Connect call
 * happens here; this reads only `launch.config.ts` and `~/.launch`.
 */

import type {
  AccountRecord,
  AppDescriptor,
  BuildArtifact,
  DashboardAccount,
  DashboardApp,
  DashboardArtifact,
  DashboardCloudHost,
  DashboardState,
  HostHandle,
  LaunchConfig,
} from '../types.js';
import type { SecretRef } from '../buildSecrets.js';
import { loadConfig } from '../config.js';
import { getActiveAccount, listAccounts } from '../accounts.js';
import { readArtifactIndex } from '../artifactRetention.js';
import { getLiveHost } from '../cloudState.js';
import { listSecretRefs } from '../buildSecrets.js';
import { LAUNCH_HOME } from '../paths.js';

/** How many of the newest build artifacts the dashboard lists — enough to be useful, not a full history. */
export const RECENT_ARTIFACT_LIMIT = 12;

const BYTES_PER_MB = 1024 * 1024;

/** The raw, already-read local state the pure builder projects — injected so the projection is testable. */
export interface DashboardInputs {
  /** Snapshot instant, stamped into {@link DashboardState.generatedAt}. */
  now: Date;
  config: LaunchConfig;
  apps: AppDescriptor[];
  accounts: AccountRecord[];
  /** Key ID of the active account, or null when none is selected. */
  activeKeyId: string | null;
  /** The artifact index, newest-first (as {@link readArtifactIndex} returns it). */
  artifacts: BuildArtifact[];
  secrets: SecretRef[];
  /** The live remote host, or null when none is allocated. */
  cloudHost: HostHandle | null;
}

/** Round a byte count to MB (one decimal), or null when there's nothing recorded. */
function toSizeMB(bytes: number): number | null {
  return bytes > 0 ? Math.round((bytes / BYTES_PER_MB) * 10) / 10 : null;
}

/** Project a discovered app to its display fields, collapsing absent optionals to null. */
function toDashboardApp(app: AppDescriptor): DashboardApp {
  return {
    name: app.name,
    version: app.version ?? null,
    bundleId: app.bundleId ?? null,
    packageName: app.packageName ?? null,
  };
}

/** Project an account, flagging the active one and counting its visible apps. */
function toDashboardAccount(account: AccountRecord, activeKeyId: string | null): DashboardAccount {
  return {
    label: account.label,
    keyId: account.keyId,
    teamId: account.teamId ?? null,
    appCount: account.apps?.length ?? 0,
    active: account.keyId === activeKeyId,
  };
}

/** Project a build artifact to its display row. */
function toDashboardArtifact(artifact: BuildArtifact): DashboardArtifact {
  return {
    app: artifact.appName,
    platform: artifact.platform,
    version: artifact.version,
    buildNumber: artifact.buildNumber,
    createdAt: artifact.createdAt,
    sizeMB: toSizeMB(artifact.sizeReport.artifactBytes),
    pruned: artifact.prunedAt !== undefined,
  };
}

/** Project the live host to its display fields, or null when none is allocated. */
function toDashboardCloudHost(host: HostHandle | null): DashboardCloudHost | null {
  if (!host) return null;
  return {
    provider: host.provider,
    region: host.region ?? null,
    instanceType: host.instanceType ?? null,
    instanceId: host.instanceId ?? null,
    allocatedAt: host.allocatedAt,
  };
}

/** Collapse the `submit` config (a single submitter, or a per-platform store map) to a display string. */
function formatSubmit(submit: LaunchConfig['submit']): string {
  if (typeof submit === 'string') return submit;
  return [...new Set(Object.values(submit).flat())].join(', ');
}

/** Pure projection of the read local state into the flat snapshot the dashboard renders. */
export function buildDashboardState(inputs: DashboardInputs): DashboardState {
  return {
    generatedAt: inputs.now.toISOString(),
    launchHome: LAUNCH_HOME,
    project: {
      providers: {
        credentials: inputs.config.credentials,
        storage: inputs.config.storage,
        buildEngine: inputs.config.buildEngine,
        submit: formatSubmit(inputs.config.submit),
      },
      profiles: Object.keys(inputs.config.profiles),
      apps: inputs.apps.map(toDashboardApp),
    },
    accounts: inputs.accounts.map((account) => toDashboardAccount(account, inputs.activeKeyId)),
    artifacts: inputs.artifacts.slice(0, RECENT_ARTIFACT_LIMIT).map(toDashboardArtifact),
    secrets: inputs.secrets.map((ref) => ({ app: ref.app, profile: ref.profile, name: ref.name })),
    cloudHost: toDashboardCloudHost(inputs.cloudHost),
  };
}

/** Read every piece of local state and project it into a {@link DashboardState}. No network calls. */
export async function gatherDashboardState(now: Date = new Date()): Promise<DashboardState> {
  const { config, apps } = await loadConfig();
  return buildDashboardState({
    now,
    config,
    apps,
    accounts: listAccounts(),
    activeKeyId: getActiveAccount()?.keyId ?? null,
    artifacts: readArtifactIndex(),
    secrets: listSecretRefs(),
    cloudHost: getLiveHost(),
  });
}
