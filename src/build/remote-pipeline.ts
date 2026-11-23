import type { BuildArtifact, SizeReport } from '../types/artifacts.ts';
import type { LaunchConfig } from '../types/config.ts';
import type { AccountRecord, AscKey, BuildCredentials } from '../types/credentials.ts';
import type { ComputeHost } from '../types/providers.ts';
import type { AllocateRequest, AwsConfig, HostHandle, RemoteTarget } from '../types/remote.ts';
import {
  receiptDestination,
  renderReceipt,
  reportProcessing,
  reportSize,
  resolveAscBuildLink,
  uploadIosBuild,
} from './pipeline-artifact.ts';
import { interactiveConfirm, resolveIosAccount } from './pipeline-signing.ts';
import type { BuildRunOptions, PreparedBuild } from './pipeline-types.ts';
import { DRY_RUN_KEY } from './pipeline-types.ts';
import { nextBuildNumber } from './pipeline-version.ts';
import { loadAscKeyById, refreshIdentityIfStale } from '../credentials/accounts.ts';
import { withSpinner } from '../services/platform/progress.ts';
import { getComputeHost } from '../services/provider-support/registry.ts';
import { resolveStorageProvider } from '../distribution/storage.ts';
import type { Logger } from '../services/platform/logger.ts';
import { LaunchPrompt, type LaunchPromptService } from '../services/platform/prompt.ts';
import { resolveArtifactsDirectory } from '../services/platform/paths.ts';
import { autoReleaseAt, costBanner } from './cost.ts';
import { clearLiveHost, getLiveHost, setLiveHost } from '../distribution/cloud-state.ts';
import { ensureRemoteSigningAssets } from '../credentials/apple-signing-assets.ts';
import type { MutableDeep } from '../types/mutable.ts';
import {
  type RemoteBuildInputs,
  openRemoteSession,
  pullArtifact,
  runBuildOnHost,
  runDoctorOnHost,
  shredHost,
  syncProject,
  uploadSigningMaterial,
} from './remote-build.ts';

function hostFor(remote: RemoteTarget): ComputeHost {
  let hostName = 'byo-ssh';

  if (remote.kind == 'aws') {
    hostName = 'aws-ec2-mac';
  }

  return getComputeHost(hostName);
}

type RemotePipelineFailure = Readonly<{
  readonly _tag: 'RemotePipelineFailure';
  readonly message: string;
}>;

function makeRemotePipelineFailure(fields: { message: string }): RemotePipelineFailure {
  return { _tag: 'RemotePipelineFailure', message: fields.message };
}

function isAwsMissingConfig(remote: RemoteTarget, launchConfig: LaunchConfig): boolean {
  if (remote.kind != 'aws') {
    return false;
  }

  return launchConfig.aws == null;
}

function awsSettings(remote: RemoteTarget, launchConfig: LaunchConfig): AwsConfig | undefined {
  if (remote.kind != 'aws') {
    return undefined;
  }

  return launchConfig.aws;
}

function isCcacheEnabled(ccache: boolean | undefined): boolean {
  return ccache != false;
}

async function reuseLiveHost(host: ComputeHost, log: Logger): Promise<HostHandle | null> {
  const live = await getLiveHost();

  if (live == null) {
    return null;
  }

  if (live.provider != host.name) {
    return null;
  }

  const status = await host.status(live);

  if (status != null) {
    log.step('acquire host', `reusing live host - ${costBanner(live)}`);
    return live;
  }

  await clearLiveHost();

  return null;
}

function noteHostProgress(log: Logger): (message: string) => void {
  return function noteProgress(message: string): void {
    log.note(message);
  };
}

async function acquireHost(
  host: ComputeHost,
  remote: RemoteTarget,
  launchConfig: LaunchConfig,
  log: Logger,
  launchPrompt: LaunchPromptService,
): Promise<HostHandle> {
  const reused = await reuseLiveHost(host, log);

  if (reused != null) {
    return reused;
  }

  if (isAwsMissingConfig(remote, launchConfig)) {
    throw makeRemotePipelineFailure({
      message:
        'AWS remote builds need an `aws: { region: ... }` block in launch.config.ts. Run `launch-store cloud setup`.',
    });
  }

  function confirmSpend(message: string): Promise<boolean> {
    return interactiveConfirm(launchPrompt, message);
  }

  const request: MutableDeep<AllocateRequest> = {
    confirm: confirmSpend,
    onProgress: noteHostProgress(log),
  };
  const aws = awsSettings(remote, launchConfig);

  if (aws != null) {
    request.aws = aws;
  }

  if (remote.kind == 'ssh') {
    request.sshTarget = remote.target;
  }

  const handle = await host.allocate(request);

  await setLiveHost(handle);

  log.step('acquire host', acquiredHostDescription(host, handle), 'ec2-mac');

  return handle;
}

async function rehearse(
  prepared: PreparedBuild,
  buildOptions: BuildRunOptions,
  buildNumber: number,
): Promise<void> {
  const app = prepared.app;
  const log = prepared.log;

  log.step(
    'acquire host',
    'would reuse the live paid-window host, or allocate one (typed cost consent first)',
  );
  log.step(
    'sync',
    "would sync the project into the host's persistent work tree (warm node_modules/ios/Pods)",
  );
  log.step(
    'upload creds',
    'would upload .p12/profile into a per-run ephemeral keychain on the host',
  );
  log.step(
    'build',
    'would run xcodebuild archive and -exportArchive on the host (incremental unless native deps changed or --clean)',
  );
  log.step('pull', 'would pull the .ipa home to ~/.launch/artifacts');
  log.step(
    'shred',
    'would shred the secrets (keychain + creds), keeping the warm work tree for next time',
  );

  if (buildOptions.submit) {
    log.step('submit', 'would upload the pulled .ipa to TestFlight', 'testflight');
  }

  log.step('host', 'would keep the host for the paid window; auto-release scheduled near 23.5h');
  log.gap();

  let appVersion = app.version;

  if (appVersion == null) {
    appVersion = '0.0.0';
  }

  log.note(`Done. ${app.name} ${appVersion} (${buildNumber}) - dry-run, nothing changed`);
}

function remoteDescriptionFor(remote: RemoteTarget): string {
  if (remote.kind == 'ssh') {
    return `SSH ${remote.target}`;
  }

  return 'AWS EC2 Mac (your account)';
}

function acquiredHostDescription(host: ComputeHost, handle: HostHandle): string {
  if (host.name != 'aws-ec2-mac') {
    return 'connected';
  }

  let instanceId = 'instance';

  if (handle.instanceId != null) {
    instanceId = handle.instanceId;
  }

  return `allocated ${instanceId}`;
}

function doctorPlan(remote: RemoteTarget): { mode: 'install' | 'assert'; description: string } {
  if (remote.kind == 'aws') {
    return { mode: 'install', description: 'host toolchain verified (gaps installed)' };
  }

  return { mode: 'assert', description: 'host toolchain verified' };
}

async function loadLiveAscKey(
  buildOptions: BuildRunOptions,
  log: Logger,
  isDryRun: boolean,
): Promise<{ ascKey: AscKey; account: AccountRecord | undefined }> {
  if (isDryRun) {
    return { ascKey: DRY_RUN_KEY, account: undefined };
  }

  const account = await resolveIosAccount(buildOptions, log);
  const loaded = await loadAscKeyById(account.keyId);

  if (loaded == null) {
    throw makeRemotePipelineFailure({
      message: `Apple account "${account.label}" has no stored key. Re-import: launch-store creds set-key`,
    });
  }

  return { ascKey: loaded, account };
}

function requireIosBundleId(bundleId: string | undefined, appName: string): string {
  const bundleIsMissing = bundleId == null;

  if (bundleIsMissing) {
    throw makeRemotePipelineFailure({
      message: `No iOS bundle identifier for ${appName}. Set ios.bundleIdentifier in app.json.`,
    });
  }

  const bundleIsBlank = bundleId == '';

  if (bundleIsBlank) {
    throw makeRemotePipelineFailure({
      message: `No iOS bundle identifier for ${appName}. Set ios.bundleIdentifier in app.json.`,
    });
  }

  return bundleId;
}

/** Build on a remote Mac. */
export async function runRemoteBuild(
  prepared: PreparedBuild,
  buildOptions: BuildRunOptions,
): Promise<void> {
  const launchConfig = prepared.config;
  const app = prepared.app;
  const profile = prepared.profile;
  const environmentValues = prepared.env;
  const log = prepared.log;
  const launchPrompt = LaunchPrompt;
  const remote = buildOptions.remote;

  if (remote == null) {
    throw makeRemotePipelineFailure({ message: 'runRemoteBuild called without a remote target.' });
  }

  const bundleId = requireIosBundleId(app.bundleId, app.name);

  const isDryRun = buildOptions.dryRun == true;

  log.step('remote', remoteDescriptionFor(remote), 'remote-build');

  const loadedKey = await loadLiveAscKey(buildOptions, log, isDryRun);
  const ascKey = loadedKey.ascKey;
  const account = loadedKey.account;
  let credentialsDescription = `key ${ascKey.keyId}`;

  if (isDryRun) {
    credentialsDescription = 'dry-run (no key needed)';
  }

  log.step('credentials', credentialsDescription, 'asc-api-key');

  function confirmCreate(message: string): Promise<boolean> {
    return interactiveConfirm(launchPrompt, message);
  }

  const signing = await ensureRemoteSigningAssets({
    platform: 'ios',
    bundleId,
    appName: app.name,
    ascKey,
    log,
    dryRun: isDryRun,
    confirmCreate,
  });

  async function readNextBuildNumber(): Promise<number> {
    const buildNumber = await nextBuildNumber(ascKey, bundleId, isDryRun);

    return buildNumber;
  }

  let buildNumber: number;

  if (isDryRun) {
    buildNumber = await readNextBuildNumber();
  } else {
    buildNumber = await withSpinner(
      'Checking last build number on App Store Connect',
      readNextBuildNumber,
    );
  }

  let buildNumberDescription = String(buildNumber);

  if (isDryRun) {
    buildNumberDescription = `would set next build number (~${buildNumber})`;
  }

  log.step('build number', buildNumberDescription, 'build-number');

  if (isDryRun) {
    await rehearse(prepared, buildOptions, buildNumber);
    return;
  }

  const host = hostFor(remote);
  const handle = await acquireHost(host, remote, launchConfig, log, launchPrompt);

  log.note(costBanner(handle));

  const inputs: RemoteBuildInputs = {
    appName: app.name,
    bundleId,
    signing,
    buildNumber,
    forceClean: buildOptions.forceClean == true,
    prebuildAlways: launchConfig.prebuild == 'always',
    ccacheEnabled: isCcacheEnabled(buildOptions.ccache),
    env: environmentValues,
  };
  let appVersion = app.version;

  if (appVersion == null) {
    appVersion = '0.0.0';
  }

  const session = await openRemoteSession(handle.ssh, app.name);
  let pulled: { ipaPath: string; sizeReport: SizeReport } | null = null;

  try {
    log.note('Syncing the project to the host...');
    await syncProject(session, app.dir);
    log.step('sync', "project synced to the host's warm work tree");
    log.note('Checking the host toolchain...');

    const doctor = doctorPlan(remote);

    await runDoctorOnHost(session, doctor.mode);
    log.step('doctor', doctor.description);
    await uploadSigningMaterial(session, inputs);
    log.step('upload creds', 'uploaded into an ephemeral keychain on the host');
    log.note('Building on the host (archive + sign + export; this can take a while)...');

    const built = await runBuildOnHost(session, inputs);
    let buildKind = 'incremental (cache warm)';

    if (built.cleanBuilt) {
      buildKind = 'clean (from scratch)';
    }

    log.step('build', `${buildKind} - built on the host`, 'incremental-build');

    const artifactsDirectory = resolveArtifactsDirectory();

    pulled = await pullArtifact(session, app.name, artifactsDirectory);
    await reportSize(pulled.sizeReport, log);

    const artifact: BuildArtifact = {
      path: pulled.ipaPath,
      platform: 'ios',
      appName: app.name,
      profile: profile.name,
      version: appVersion,
      buildNumber,
      sizeReport: pulled.sizeReport,
      clean: built.cleanBuilt,
      createdAt: new Date().toISOString(),
    };
    const storageProvider = await resolveStorageProvider(launchConfig);
    const stored = await storageProvider.put(artifact);

    log.step('store', stored.location);
  } finally {
    try {
      await shredHost(session);
      log.step(
        'shred',
        'secrets shredded (keychain + creds); warm work tree kept for the next build',
      );
    } catch (error) {
      const shredFailed = error != null;

      if (shredFailed) {
        log.warn('Could not fully shred the host session - check the host manually.');
      }
    }
  }

  if (pulled == null) {
    throw makeRemotePipelineFailure({
      message: 'Remote build completed without pulling the .ipa home.',
    });
  }

  if (buildOptions.submit) {
    const credentials: BuildCredentials = { platform: 'ios', ascKey };
    const submitArtifact = { path: pulled.ipaPath, version: appVersion, buildNumber };

    await uploadIosBuild(prepared, buildOptions, submitArtifact, pulled.sizeReport, credentials);
    await reportProcessing(ascKey, bundleId, buildNumber, log);
  }

  if (handle.provider == 'aws-ec2-mac') {
    log.note(
      `Host kept alive for the paid window (run \`launch-store cloud teardown\` when done; ` +
        `it auto-releases near ${new Date(autoReleaseAt(handle.allocatedAt)).toLocaleTimeString()}).`,
    );
  }

  if (account != null) {
    await refreshIdentityIfStale(account, ascKey);
  }

  let link: string | undefined;

  if (buildOptions.submit) {
    link = await resolveAscBuildLink(ascKey, bundleId);
  }

  await renderReceipt({
    app,
    version: appVersion,
    buildNumber,
    report: pulled.sizeReport,
    destination: receiptDestination('ios', buildOptions),
    link,
    log,
  });
}
