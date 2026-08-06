import { Data, Effect } from 'effect';
import type { ResolvedBuildContext } from '../types/config.js';
import type { NotifyEvent } from '../services/notify.js';
import { notify } from '../services/notify.js';
import { loadConfig } from '../config/config.js';
import { checkApp, formatFinding } from '../config/configCheck.js';
import { ENV_SOURCE, envInjectionRows } from '../config/env.js';
import { createLogger } from '../services/logger.js';
import {
  resolveStorageProvider,
  type StorageResolverRequirements,
} from '../distribution/storage.js';
import type { BuildRunOptions, PreparedBuild } from './pipelineTypes.js';
import {
  resolveAndroidRelease,
  resolveAndroidSubmitReleaseNotes,
  resolveBuildTransport,
} from './pipelineProviders.js';
import { previewEnv, resolveCommandEnv, selectApp, validateResolvedEnv } from './pipelineEnv.js';
import { receiptDestination, worstDownloadBytes } from './pipelineArtifact.js';
import { runIosBuild } from './pipelineIos.js';
import { runAndroidBuild } from './pipelineAndroid.js';
/** App configuration failed the pre-build footgun check. */
export type BuildPreparationFailure = Readonly<{
  readonly _tag: 'BuildPreparationFailure';
  readonly appName: string;
  readonly message: string;
}>;
export const makeBuildPreparationFailure =
  Data.tagged<BuildPreparationFailure>('BuildPreparationFailure');
/**
 * Resolve the shared front half of a build: config, the chosen app, the profile, a validated env, a
 * logger, and the {@link ResolvedBuildContext}. Identical for iOS and Android - every build path
 * (local, remote, EAS) starts here so app selection and env validation never drift; the platforms
 * diverge only in HOW they build (see {@link runIosBuild} / {@link runAndroidBuild}).
 */
export const prepareBuild = (options: BuildRunOptions) =>
  Effect.gen(function* () {
    const { dryRun, platform } = options;
    const log = yield* createLogger(options.explain);
    const { config, apps } = yield* loadConfig();
    const app = yield* selectApp(apps, options.appName);
    let profile = config.profiles[options.profileName];
    if (profile === undefined) {
      profile = {
        name: options.profileName,
        sizeBudgetMB: 200,
      };
    }
    let remoteSuffix = '';
    if (options.remote !== undefined) {
      remoteSuffix = ' - remote(ssh)';
      if (options.remote.kind === 'aws') remoteSuffix = ' - remote(aws)';
    }
    let dryRunSuffix = '';
    if (dryRun) dryRunSuffix = ' - dry-run';
    yield* log.step(
      'config',
      `${log.chip(app.name)} - ${profile.name} - ${platform}${dryRunSuffix}${remoteSuffix}`,
    );
    // Resolve + validate env before any expensive work, so a missing/secret-looking key fails fast.
    const resolved = yield* resolveCommandEnv({
      app,
      profile,
      cliEnv: options.envOverrides,
      includeLocal: options.includeLocal,
      envExclude: config.envExclude,
    });
    const env = resolved.values;
    yield* validateResolvedEnv(app.dir, resolved, log, config.envExclude);
    const secretCount = Object.values(resolved.sources).filter(
      (source) => source === ENV_SOURCE.secret,
    ).length;
    const varCount = Object.keys(env).length;
    let keychainNote = '';
    if (secretCount > 0) keychainNote = ` (${secretCount} from keychain)`;
    let injectionNote = '';
    if (varCount > 0) injectionNote = ' -> injecting into bundle:';
    // The count summary, then one provenance row per var (KEY -> source, no values) so a run visibly
    // confirms every layer reaches the bundle step - local iOS used to drop everything above `.env`.
    yield* log.step('env', `${varCount} vars validated${keychainNote}${injectionNote}`, 'env-vars');
    for (const environmentSourceLine of envInjectionRows(resolved))
      yield* log.note(environmentSourceLine);
    if (resolved.excluded.length > 0) {
      yield* log.tip(`excluded (envExclude, not injected): ${resolved.excluded.join(', ')}`);
    }
    // Preflight the app config against known native-config footguns, before any expensive native work.
    // Warnings are surfaced; a build-breaking error (an invalid bundle id / package, a splash with no
    // backgroundColor) hard-stops here rather than failing deep inside xcodebuild/gradle minutes later.
    const findings = yield* checkApp(app, platform);
    for (const finding of findings) {
      if (finding.severity === 'warn') yield* log.warn(formatFinding(finding));
    }
    const configErrors = findings.filter((finding) => finding.severity === 'error');
    if (configErrors.length > 0) {
      return yield* Effect.fail(
        makeBuildPreparationFailure({
          appName: app.name,
          message: `App config preflight failed for ${app.name}:\n${configErrors.map((finding) => `  x ${formatFinding(finding)}`).join('\n')}`,
        }),
      );
    }
    let configCheckDescription = 'no footguns';
    if (findings.length > 0) configCheckDescription = `${findings.length} warning(s)`;
    yield* log.step('config check', configCheckDescription);
    let buildContext: ResolvedBuildContext = {
      platform,
      app,
      profile,
      env,
      explain: options.explain,
      dryRun,
      forceClean: options.forceClean === true,
    };
    if (options.ccache !== undefined) buildContext = { ...buildContext, ccache: options.ccache };
    if (platform === 'android') {
      let androidRelease = resolveAndroidRelease(options, profile);
      const releaseNotes = yield* resolveAndroidSubmitReleaseNotes(
        config,
        app.dir,
        options.notesPath,
      ).pipe(
        Effect.mapError((cause) => {
          let detail = 'unknown error';
          if (typeof cause === 'string' && cause.length > 0) detail = cause;
          if (cause instanceof Error) detail = cause.message;
          if (typeof cause === 'object' && cause !== null && 'message' in cause) {
            const causeMessage = cause.message;
            if (typeof causeMessage === 'string' && causeMessage.length > 0) detail = causeMessage;
          }
          return makeBuildPreparationFailure({
            appName: app.name,
            message: `Could not resolve Android release notes for ${app.name}: ${detail}`,
          });
        }),
      );
      if (releaseNotes.length > 0) {
        androidRelease = { ...androidRelease, releaseNotes };
      }
      buildContext = { ...buildContext, android: androidRelease };
    }
    if (options.distribution !== undefined)
      buildContext = { ...buildContext, distribution: options.distribution };
    return { config, app, profile, env, buildContext, log };
  });
/**
 * Run a build, then fire any configured completion notification. Throws with a clear message on any
 * failed step - but first notifies the failure, so an unattended/CI build pings on both outcomes.
 * Dry-runs never notify (they change nothing). See {@link dispatchBuild} for the path selection.
 */
export const runBuild = (options: BuildRunOptions) =>
  Effect.gen(function* () {
    if (options.printEnv) {
      return yield* previewEnv(options);
    }
    const prepared = yield* prepareBuild(options);
    return yield* dispatchBuild(prepared, options).pipe(
      Effect.tap(() => {
        if (options.dryRun) return Effect.void;
        return buildSuccessEvent(prepared, options).pipe(
          Effect.flatMap((notificationEvent) => notify(prepared.config, notificationEvent)),
        );
      }),
      Effect.tapError((buildFailure) => {
        if (options.dryRun) return Effect.void;
        return notify(prepared.config, buildFailureEvent(prepared, options, buildFailure));
      }),
    );
  });
/**
 * Select the build fork via {@link resolveBuildTransport}, then invoke that adapter.
 * The remote / EAS modules are imported lazily so a local-only build never loads the host or Expo code paths.
 */
const dispatchBuild = (prepared: PreparedBuild, options: BuildRunOptions) =>
  Effect.gen(function* () {
    const choice = yield* resolveBuildTransport(
      options.platform,
      prepared.config.buildEngine,
      options.remote,
    );
    switch (choice.kind) {
      case 'local':
        return yield* runLocalBuild(prepared, options);
      case 'remote': {
        const { runRemoteBuild } = yield* Effect.promise(() => import('./remotePipeline.js'));
        return yield* runRemoteBuild(prepared, { ...options, remote: choice.remote });
      }
      case 'eas': {
        const { runEasBuild } = yield* Effect.promise(() => import('./easPipeline.js'));
        return yield* runEasBuild(prepared, options);
      }
    }
  });
/**
 * The success {@link NotifyEvent} for a finished run, read back from the artifact just stored (the
 * source of truth for the build number + size). `event` is `submit` once a store upload happened, else
 * `build` (a `--no-submit` or internal install-link run). Falls back to the app's config version when
 * no stored artifact is found (e.g. a remote/EAS path that stores elsewhere).
 */
const buildSuccessEvent = (
  prepared: PreparedBuild,
  options: BuildRunOptions,
): Effect.Effect<NotifyEvent, unknown, StorageResolverRequirements> =>
  Effect.gen(function* () {
    const { config, app, buildContext } = prepared;
    const internal = buildContext.distribution === 'internal';
    const storageProvider = yield* resolveStorageProvider(config);
    const storedArtifacts = yield* storageProvider.list();
    const latest = storedArtifacts.find(
      (artifact) => artifact.appName === app.name && artifact.platform === options.platform,
    );
    let eventName: NotifyEvent['event'] = 'build';
    if (options.submit && !internal) eventName = 'submit';
    let eventVersion = app.version;
    if (latest?.version !== undefined) eventVersion = latest.version;
    if (eventVersion === undefined) eventVersion = '0.0.0';
    let destination = receiptDestination(options.platform, options, buildContext.android?.track);
    if (internal) destination = 'internal install link';
    const notificationEvent: NotifyEvent = {
      event: eventName,
      status: 'success',
      app: app.name,
      platform: options.platform,
      version: eventVersion,
      destination,
    };
    if (latest) {
      notificationEvent.buildNumber = latest.buildNumber;
      const size = worstDownloadBytes(latest.sizeReport);
      if (size > 0) notificationEvent.sizeBytes = size;
    }
    return notificationEvent;
  });
/** The failure {@link NotifyEvent} for a run that threw, carrying the error message and what's known. */
const buildFailureEvent = (
  prepared: PreparedBuild,
  options: BuildRunOptions,
  error: unknown,
): NotifyEvent => {
  const internal = prepared.buildContext.distribution === 'internal';
  let eventName: NotifyEvent['event'] = 'build';
  if (options.submit && !internal) eventName = 'submit';
  let appVersion = prepared.app.version;
  if (appVersion === undefined) appVersion = '0.0.0';
  let errorMessage = String(error);
  if (error instanceof Error) errorMessage = error.message;
  return {
    event: eventName,
    status: 'failure',
    app: prepared.app.name,
    platform: options.platform,
    version: appVersion,
    error: errorMessage,
  };
};
/** The local spine: fork by platform after the shared front (prepareBuild) and before the shared tail. */
const runLocalBuild = (prepared: PreparedBuild, options: BuildRunOptions) => {
  if (prepared.buildContext.platform === 'android') return runAndroidBuild(prepared, options);
  return runIosBuild(prepared, options);
};
