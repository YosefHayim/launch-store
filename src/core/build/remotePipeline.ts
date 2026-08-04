import type { BuildArtifact, SizeReport } from '../types/artifacts.js';
import { Data, Effect } from 'effect';
import type { LaunchConfig } from '../types/config.js';
import type { AccountRecord, AscKey } from '../types/credentials.js';
import type { ComputeHost } from '../types/providers.js';
import type { AllocateRequest, RemoteTarget } from '../types/remote.js';
import {
  receiptDestination,
  renderReceipt,
  reportProcessing,
  reportSize,
  resolveAscBuildLink,
} from './pipelineArtifact.js';
import { interactiveConfirm, resolveIosAccount } from './pipelineSigning.js';
import type { BuildRunOptions, PreparedBuild } from './pipelineTypes.js';
import { DRY_RUN_KEY } from './pipelineTypes.js';
import { nextBuildNumber } from './pipelineVersion.js';
import { loadAscKeyById, refreshIdentityIfStale } from '../credentials/accounts.js';
import { withSpinner } from '../services/progress.js';
import { getComputeHost } from '../services/registry.js';
import { resolveStorageProvider } from '../distribution/storage.js';
import type { Logger } from '../services/logger.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import { ARTIFACTS_DIR } from '../services/paths.js';
import { autoReleaseAt, costBanner } from './cost.js';
import { clearLiveHost, getLiveHost, setLiveHost } from '../distribution/cloudState.js';
import { ensureRemoteSigningAssets } from '../credentials/appleSigning.js';
import type { MutableDeep } from '../types/mutable.js';
import {
  type RemoteBuildInputs,
  openRemoteSession,
  pullArtifact,
  runBuildOnHost,
  runDoctorOnHost,
  shredHost,
  syncProject,
  uploadSigningMaterial,
} from './remoteBuild.js';
/** Resolve the compute host backend for a remote target. */
const hostFor = (remote: RemoteTarget) => {
  let hostName = 'byo-ssh';
  if (remote.kind === 'aws') hostName = 'aws-ec2-mac';
  return getComputeHost(hostName);
};

/** Remote build setup or orchestration failed before a valid artifact was produced. */
export type RemotePipelineFailure = Readonly<{
  readonly _tag: 'RemotePipelineFailure';
  readonly message: string;
}>;
export const makeRemotePipelineFailure =
  Data.tagged<RemotePipelineFailure>('RemotePipelineFailure');

/** Reuse the live paid-window host (if one of this provider is still up) or allocate a fresh one. */
const acquireHost = (
  host: ComputeHost,
  remote: RemoteTarget,
  config: LaunchConfig,
  log: Logger,
  launchPrompt: LaunchPromptService,
) =>
  Effect.gen(function* () {
    const live = yield* getLiveHost();
    if (live?.provider === host.name) {
      const status = yield* host.status(live);
      if (status) {
        yield* log.step('acquire host', `reusing live host - ${costBanner(live)}`);
        return live;
      }
      yield* clearLiveHost();
    }
    if (remote.kind === 'aws' && !config.aws) {
      return yield* Effect.fail(
        makeRemotePipelineFailure({
          message:
            'AWS remote builds need an `aws: { region: ... }` block in launch.config.ts. Run `launch cloud setup`.',
        }),
      );
    }
    const request: MutableDeep<AllocateRequest> = {
      confirm: (message) => interactiveConfirm(launchPrompt, message),
      onProgress: (message) => {
        Effect.runFork(log.note(message));
      },
    };
    if (remote.kind === 'aws' && config.aws !== undefined) request.aws = config.aws;
    if (remote.kind === 'ssh') request.sshTarget = remote.target;
    const handle = yield* host.allocate(request);
    yield* setLiveHost(handle);
    let acquiredDescription = 'connected';
    if (host.name === 'aws-ec2-mac') {
      let instanceId = handle.instanceId;
      if (instanceId === undefined) instanceId = 'instance';
      acquiredDescription = `allocated ${instanceId}`;
    }
    yield* log.step('acquire host', acquiredDescription, 'ec2-mac');
    return handle;
  });
/** Rehearse the remote flow without touching AWS, SSH, or the account (mirrors the local dry-run). */
const rehearse = (prepared: PreparedBuild, options: BuildRunOptions, buildNumber: number) =>
  Effect.gen(function* () {
    const { app, log } = prepared;
    yield* log.step(
      'acquire host',
      'would reuse the live paid-window host, or allocate one (typed cost consent first)',
    );
    yield* log.step(
      'sync',
      "would sync the project into the host's persistent work tree (warm node_modules/ios/Pods)",
    );
    yield* log.step(
      'upload creds',
      'would upload .p8/.p12/profile into a per-run ephemeral keychain on the host',
    );
    yield* log.step(
      'build',
      'would run fastlane gym on the host (incremental unless native deps changed or --clean)',
    );
    if (options.submit) {
      let storeDestination = 'App Store review';
      if (options.target === 'testing') storeDestination = 'TestFlight';
      yield* log.step('submit', `would upload to ${storeDestination} from the host`, 'testflight');
    }
    yield* log.step('pull', 'would pull the .ipa home to ~/.launch/artifacts');
    yield* log.step(
      'shred',
      'would shred the secrets (keychain + creds), keeping the warm work tree for next time',
    );
    yield* log.step(
      'host',
      'would keep the host for the paid window; auto-release scheduled near 23.5h',
    );
    yield* log.gap();
    let appVersion = app.version;
    if (appVersion === undefined) appVersion = '0.0.0';
    yield* log.note(`Done. ${app.name} ${appVersion} (${buildNumber}) - dry-run, nothing changed`);
  });
/**
 * Build (and optionally submit) on a remote Mac. Reuses {@link PreparedBuild} from the front half.
 * Shred always runs (success or failure); the AWS host is kept alive for the already-paid window.
 */
export const runRemoteBuild = (prepared: PreparedBuild, options: BuildRunOptions) =>
  Effect.gen(function* () {
    const { config, app, profile, env, log } = prepared;
    const launchPrompt = yield* LaunchPrompt;
    const remote = options.remote;
    if (!remote)
      return yield* Effect.fail(
        makeRemotePipelineFailure({ message: 'runRemoteBuild called without a remote target.' }),
      );
    const bundleId = app.bundleId;
    if (!bundleId)
      return yield* Effect.fail(
        makeRemotePipelineFailure({
          message: `No iOS bundle identifier for ${app.name}. Set ios.bundleIdentifier in app.json.`,
        }),
      );
    const { dryRun } = options;
    // C1. Resolve the Apple account + signing material locally (cross-platform), and the build number via ASC.
    let remoteDescription = 'SSH remote Mac';
    if (remote.kind === 'ssh') remoteDescription = `SSH ${remote.target}`;
    if (remote.kind === 'aws') remoteDescription = 'AWS EC2 Mac (your account)';
    yield* log.step('remote', remoteDescription, 'remote-build');
    let ascKey: AscKey = DRY_RUN_KEY;
    let account: AccountRecord | undefined;
    if (!dryRun) {
      account = yield* resolveIosAccount(options, log);
      const loaded = yield* loadAscKeyById(account.keyId);
      if (!loaded)
        return yield* Effect.fail(
          makeRemotePipelineFailure({
            message: `Apple account "${account.label}" has no stored key. Re-import: launch creds set-key`,
          }),
        );
      ascKey = loaded;
    }
    let credentialsDescription = `key ${ascKey.keyId}`;
    if (dryRun) credentialsDescription = 'dry-run (no key needed)';
    yield* log.step('credentials', credentialsDescription, 'asc-api-key');
    const signing = yield* ensureRemoteSigningAssets({
      // Remote builds are iOS-only in v1: the host bootstrap script is iOS-shaped and a guard rejects
      // `--remote` for the other Apple platforms before reaching here, so signing is always iOS.
      platform: 'ios',
      bundleId,
      appName: app.name,
      ascKey,
      log,
      dryRun,
      confirmCreate: (message) => interactiveConfirm(launchPrompt, message),
    });
    let buildNumber: number;
    if (dryRun) {
      buildNumber = yield* nextBuildNumber(ascKey, bundleId, dryRun);
    } else {
      buildNumber = yield* withSpinner('Checking last build number on App Store Connect', () =>
        nextBuildNumber(ascKey, bundleId, dryRun),
      );
    }
    let buildNumberDescription = String(buildNumber);
    if (dryRun) buildNumberDescription = `would set next build number (~${buildNumber})`;
    yield* log.step('build number', buildNumberDescription, 'build-number');
    if (dryRun) {
      yield* rehearse(prepared, options, buildNumber);
      return;
    }
    // C2. Acquire (reuse or allocate) the host.
    const host = yield* hostFor(remote);
    const handle = yield* acquireHost(host, remote, config, log, launchPrompt);
    yield* log.note(costBanner(handle));
    const inputs: RemoteBuildInputs = {
      appName: app.name,
      bundleId,
      signing,
      ascKey,
      buildNumber,
      submit: options.submit,
      submitTarget: options.target,
      forceClean: options.forceClean === true,
      ccacheEnabled: options.ccache !== false,
      env,
    };
    const session = yield* openRemoteSession(handle.ssh, app.name);
    let sizeReport: SizeReport | null = null;
    try {
      // C4 + spine. Sync source into the persistent tree, upload transient creds, build (+submit) on the host.
      yield* log.note('Syncing the project to the host...');
      yield* syncProject(session, app.dir);
      yield* log.step('sync', "project synced to the host's warm work tree");
      // The remote twin of `launch doctor`: install gaps on our AWS host, assert (never mutate) a BYO host.
      yield* log.note('Checking the host toolchain...');
      let doctorMode: 'install' | 'assert' = 'assert';
      let doctorDescription = 'host toolchain verified';
      if (remote.kind === 'aws') {
        doctorMode = 'install';
        doctorDescription = 'host toolchain verified (gaps installed)';
      }
      yield* runDoctorOnHost(session, doctorMode);
      yield* log.step('doctor', doctorDescription);
      yield* uploadSigningMaterial(session, inputs);
      yield* log.step('upload creds', 'uploaded into an ephemeral keychain on the host');
      yield* log.note('Building on the host (archive + sign + export; this can take a while)...');
      const { cleanBuilt } = yield* runBuildOnHost(session, inputs);
      let buildKind = 'incremental (cache warm)';
      if (cleanBuilt) buildKind = 'clean (from scratch)';
      let buildAction = 'built';
      if (options.submit) buildAction = 'built and submitted';
      yield* log.step('build', `${buildKind} - ${buildAction} on the host`, 'incremental-build');
      // C5. Pull the artifact home and store it for `launch release`. The upload already happened on the
      // host (bundled with the build), so this is a display-only size readout, not a pre-upload gate.
      const pulled = yield* pullArtifact(session, app.name, ARTIFACTS_DIR);
      sizeReport = pulled.sizeReport;
      yield* reportSize(pulled.sizeReport, log);
      let appVersion = app.version;
      if (appVersion === undefined) appVersion = '0.0.0';
      const artifact: BuildArtifact = {
        path: pulled.ipaPath,
        platform: 'ios',
        appName: app.name,
        profile: profile.name,
        version: appVersion,
        buildNumber,
        sizeReport: pulled.sizeReport,
        // The host decides clean-vs-incremental from its own warm tree and reports it back.
        clean: cleanBuilt,
        createdAt: new Date().toISOString(),
      };
      const storageProvider = yield* resolveStorageProvider(config);
      const stored = yield* storageProvider.put(artifact);
      yield* log.step('store', stored.location);
      if (options.submit && options.target === 'testing') {
        yield* log.step('submit', 'uploaded to TestFlight from the host', 'testflight');
      }
    } finally {
      // C6. Shred the host session on every exit path (success or build failure).
      try {
        yield* shredHost(session);
        yield* log.step(
          'shred',
          'secrets shredded (keychain + creds); warm work tree kept for the next build',
        );
      } catch {
        yield* log.warn('Could not fully shred the host session - check the host manually.');
      }
    }
    // C7. Surface Apple-side processing for a TestFlight upload (the build uploaded from the host; we
    // poll ASC locally for parity with the local spine), then the host disposition, then the receipt.
    if (options.submit && options.target === 'testing') {
      yield* reportProcessing(ascKey, bundleId, buildNumber, log);
    }
    // Keep AWS hosts alive for the already-paid window; auto-release is scheduled near 23.5h.
    if (handle.provider === 'aws-ec2-mac') {
      yield* log.note(
        `Host kept alive for the paid window (run \`launch cloud teardown\` when done; ` +
          `it auto-releases near ${new Date(autoReleaseAt(handle.allocatedAt)).toLocaleTimeString()}).`,
      );
    }
    // Backfill the account's Team ID + app names from Apple now that we have a live key in hand.
    if (account) yield* refreshIdentityIfStale(account, ascKey);
    // Reaching here means the try block completed, so the size report is set.
    let link: string | undefined;
    if (options.submit) link = yield* resolveAscBuildLink(ascKey, bundleId, options.target);
    if (sizeReport === null) {
      return yield* Effect.fail(
        makeRemotePipelineFailure({
          message: 'Remote build completed without a size report.',
        }),
      );
    }
    let appVersion = app.version;
    if (appVersion === undefined) appVersion = '0.0.0';
    yield* renderReceipt({
      app,
      version: appVersion,
      buildNumber,
      report: sizeReport,
      destination: receiptDestination('ios', options),
      link,
      log,
    });
  });
