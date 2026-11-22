import { setCommandEnvironmentExclusions } from '../services/platform/exec.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { ResolvedBuildContext } from '../types/config.ts';
import type { MutableDeep } from '../types/mutable.ts';
import type { NotifyEvent } from '../services/platform/notify.ts';
import { notify } from '../services/platform/notify.ts';
import { loadConfig } from '../config/config.ts';
import { checkApp, formatFinding } from '../config/config-check.ts';
import { ENV_SOURCE, envInjectionRows } from '../config/env.ts';
import { createLogger } from '../services/platform/logger.ts';
import { resolveStorageProvider } from '../distribution/storage.ts';
import type { BuildArtifact } from '../types/artifacts.ts';
import type { Platform } from '../types/app.ts';
import type { BuildRunOptions, PreparedBuild } from './pipeline-types.ts';
import {
  resolveAndroidRelease,
  resolveAndroidSubmitReleaseNotes,
  resolveBuildTransport,
} from './pipeline-providers.ts';
import { previewEnv, resolveCommandEnv, selectApp, validateResolvedEnv } from './pipeline-env.ts';
import { receiptDestination, worstDownloadBytes } from './pipeline-artifact.ts';
import { runIosBuild } from './pipeline-ios.ts';
import { runAndroidBuild } from './pipeline-android.ts';
import { hasMessage } from '../services/platform/error-message.ts';

/** App configuration failed the pre-build footgun check. */
type BuildPreparationFailure = Readonly<{
  readonly _tag: 'BuildPreparationFailure';
  readonly appName: string;
  readonly message: string;
}>;

function makeBuildPreparationFailure(fields: {
  appName: string;
  message: string;
}): BuildPreparationFailure {
  return { _tag: 'BuildPreparationFailure', appName: fields.appName, message: fields.message };
}

type ConfigFinding = Parameters<typeof formatFinding>[0];

function isSecretSource(environmentSource: string): boolean {
  return environmentSource == ENV_SOURCE.secret;
}

function isConfigWarning(finding: ConfigFinding): boolean {
  return finding.severity == 'warn';
}

function isConfigError(finding: ConfigFinding): boolean {
  return finding.severity == 'error';
}

function formatConfigError(finding: ConfigFinding): string {
  return `  x ${formatFinding(finding)}`;
}

function nonEmptyString(cause: unknown): string | null {
  if (typeof cause != 'string') {
    return null;
  }

  if (cause.length == 0) {
    return null;
  }

  return cause;
}

function readObjectMessage(cause: unknown): string | null {
  if (typeof cause != 'object') {
    return null;
  }

  if (cause == null) {
    return null;
  }

  if ('message' in cause == false) {
    return null;
  }

  const causeMessage = cause.message;

  if (typeof causeMessage != 'string') {
    return null;
  }

  if (causeMessage.length == 0) {
    return null;
  }

  return causeMessage;
}

function readFailureDetail(cause: unknown): string {
  let detail = 'unknown error';
  const stringDetail = nonEmptyString(cause);

  if (stringDetail != null) {
    detail = stringDetail;
  }

  if (hasMessage(cause)) {
    detail = cause.message;
  }

  const objectMessage = readObjectMessage(cause);

  if (objectMessage != null) {
    detail = objectMessage;
  }

  return detail;
}

function copyApp(app: AppDescriptor): MutableDeep<AppDescriptor> {
  const draftApp: MutableDeep<AppDescriptor> = {
    name: app.name,
    dir: app.dir,
    configPath: app.configPath,
  };

  if (app.bundleId != null) {
    draftApp.bundleId = app.bundleId;
  }

  if (app.packageName != null) {
    draftApp.packageName = app.packageName;
  }

  if (app.version != null) {
    draftApp.version = app.version;
  }

  if (app.iosEntitlements != null) {
    draftApp.iosEntitlements = { ...app.iosEntitlements };
  }

  if (app.iosExtensions != null) {
    draftApp.iosExtensions = [...app.iosExtensions];
  }

  if (app.androidVersionCode != null) {
    draftApp.androidVersionCode = app.androidVersionCode;
  }

  if (app.usesNonExemptEncryption != null) {
    draftApp.usesNonExemptEncryption = app.usesNonExemptEncryption;
  }

  return draftApp;
}

function remoteSuffixFor(buildOptions: BuildRunOptions): string {
  const hasRemote = buildOptions.remote != null;

  if (hasRemote == false) {
    return '';
  }

  const isAws = buildOptions.remote?.kind == 'aws';

  if (isAws) {
    return ' - remote(aws)';
  }

  return ' - remote(ssh)';
}

async function attachAndroidRelease(
  preparedAppName: string,
  launchConfig: PreparedBuild['config'],
  buildOptions: BuildRunOptions,
  appDir: string,
  buildContext: MutableDeep<ResolvedBuildContext>,
): Promise<MutableDeep<ResolvedBuildContext>> {
  const resolvedAndroidRelease = resolveAndroidRelease(buildOptions, buildContext.profile);
  const androidRelease: MutableDeep<typeof resolvedAndroidRelease> = {
    track: resolvedAndroidRelease.track,
    rollout: resolvedAndroidRelease.rollout,
  };

  let releaseNotes: Awaited<ReturnType<typeof resolveAndroidSubmitReleaseNotes>>;

  try {
    releaseNotes = await resolveAndroidSubmitReleaseNotes(
      launchConfig,
      appDir,
      buildOptions.notesPath,
    );
  } catch (error) {
    throw makeBuildPreparationFailure({
      appName: preparedAppName,
      message: `Could not resolve Android release notes for ${preparedAppName}: ${readFailureDetail(error)}`,
    });
  }

  const hasReleaseNotes = releaseNotes.length > 0;

  if (hasReleaseNotes) {
    androidRelease.releaseNotes = [...releaseNotes];
  }

  return { ...buildContext, android: androidRelease };
}

/**
 * Resolve config, the chosen app, the profile, a validated env, a logger, and the build context.
 * Local, remote, and EAS builds all start here.
 */
export async function prepareBuild(buildOptions: BuildRunOptions): Promise<PreparedBuild> {
  const isDryRun = buildOptions.dryRun == true;
  const platform = buildOptions.platform;
  const log = createLogger(buildOptions.explain);
  const loaded = await loadConfig();
  const launchConfig = loaded.config;
  const app = await selectApp(loaded.apps, buildOptions.appName);
  let profile = launchConfig.profiles[buildOptions.profileName];

  if (profile == null) {
    profile = { name: buildOptions.profileName, sizeBudgetMB: 200 };
  }

  let dryRunSuffix = '';

  if (isDryRun) {
    dryRunSuffix = ' - dry-run';
  }

  const remoteSuffix = remoteSuffixFor(buildOptions);

  log.step(
    'config',
    `${log.chip(app.name)} - ${profile.name} - ${platform}${dryRunSuffix}${remoteSuffix}`,
  );

  const resolved = await resolveCommandEnv({
    app,
    profile,
    cliEnv: buildOptions.envOverrides,
    includeLocal: buildOptions.includeLocal,
    envExclude: launchConfig.envExclude,
  });
  const environmentValues = resolved.values;

  await validateResolvedEnv(app.dir, resolved, log, launchConfig.envExclude ?? []);

  const secretCount = Object.values(resolved.sources).filter(isSecretSource).length;
  const varCount = Object.keys(environmentValues).length;
  let keychainNote = '';

  if (secretCount > 0) {
    keychainNote = ` (${secretCount} from keychain)`;
  }

  let injectionNote = '';

  if (varCount > 0) {
    injectionNote = ' -> injecting into bundle:';
  }

  log.step('env', `${varCount} vars validated${keychainNote}${injectionNote}`, 'env-vars');

  for (const environmentSourceLine of envInjectionRows(resolved)) {
    log.note(environmentSourceLine);
  }

  const hasExclusions = resolved.excluded.length > 0;

  if (hasExclusions) {
    log.tip(`excluded (envExclude, not injected): ${resolved.excluded.join(', ')}`);
  }

  const findings: ConfigFinding[] = await checkApp(app, platform);

  for (const finding of findings) {
    const isWarning = isConfigWarning(finding);

    if (isWarning) {
      log.warn(formatFinding(finding));
    }
  }

  const configErrors = findings.filter(isConfigError);
  const hasConfigErrors = configErrors.length > 0;

  if (hasConfigErrors) {
    const errorLines = configErrors.map(formatConfigError);

    throw makeBuildPreparationFailure({
      appName: app.name,
      message: `App config preflight failed for ${app.name}:\n${errorLines.join('\n')}`,
    });
  }

  let configCheckDescription = 'no footguns';

  if (findings.length > 0) {
    configCheckDescription = `${findings.length} warning(s)`;
  }

  log.step('config check', configCheckDescription);

  const draftApp = copyApp(app);
  let buildContext: MutableDeep<ResolvedBuildContext> = {
    platform,
    app: draftApp,
    profile,
    env: { ...environmentValues },
    explain: buildOptions.explain,
    dryRun: isDryRun,
    forceClean: buildOptions.forceClean == true,
  };
  const ccacheFlag = buildOptions.ccache;
  const hasCcacheFlag = ccacheFlag != null;

  if (hasCcacheFlag) {
    buildContext = { ...buildContext, ccache: ccacheFlag };
  }

  const isAndroid = platform == 'android';

  if (isAndroid) {
    buildContext = await attachAndroidRelease(
      app.name,
      launchConfig,
      buildOptions,
      app.dir,
      buildContext,
    );
  }

  const chosenDistribution = buildOptions.distribution;
  const hasDistribution = chosenDistribution != null;

  if (hasDistribution) {
    buildContext = { ...buildContext, distribution: chosenDistribution };
  }

  return {
    config: launchConfig,
    app: draftApp,
    profile,
    env: environmentValues,
    buildContext,
    log,
  };
}

function wantsStoreEvent(shouldSubmit: boolean, isInternal: boolean): boolean {
  if (shouldSubmit == false) {
    return false;
  }

  return isInternal == false;
}

function isStoredForApp(appName: string, platform: Platform) {
  return function matches(artifact: BuildArtifact): boolean {
    const isSameApp = artifact.appName == appName;

    if (isSameApp == false) {
      return false;
    }

    return artifact.platform == platform;
  };
}

async function buildSuccessEvent(
  prepared: PreparedBuild,
  buildOptions: BuildRunOptions,
): Promise<NotifyEvent> {
  const launchConfig = prepared.config;
  const app = prepared.app;
  const buildContext = prepared.buildContext;
  const isInternal = buildContext.distribution == 'internal';
  const storageProvider = await resolveStorageProvider(launchConfig);
  const storedArtifacts = await storageProvider.list();
  const latest = storedArtifacts.find(isStoredForApp(app.name, buildOptions.platform));
  let eventName: NotifyEvent['event'] = 'build';
  const shouldNameSubmit = wantsStoreEvent(buildOptions.submit, isInternal);

  if (shouldNameSubmit) {
    eventName = 'submit';
  }

  let eventVersion = app.version;
  const storedVersion = latest?.version;

  if (storedVersion != null) {
    eventVersion = storedVersion;
  }

  if (eventVersion == null) {
    eventVersion = '0.0.0';
  }

  let destination = receiptDestination(
    buildOptions.platform,
    buildOptions,
    buildContext.android?.track,
  );

  if (isInternal) {
    destination = 'internal install link';
  }

  const notificationEvent: NotifyEvent = {
    event: eventName,
    status: 'success',
    app: app.name,
    platform: buildOptions.platform,
    version: eventVersion,
    destination,
    ...storedBuildFields(latest),
  };

  return notificationEvent;
}

function isStoredArtifact(latest: BuildArtifact | undefined): latest is BuildArtifact {
  return latest != null;
}

function fieldsFromArtifact(latest: BuildArtifact): { buildNumber: number; sizeBytes?: number } {
  const size = worstDownloadBytes(latest.sizeReport);
  const hasSize = size > 0;

  if (hasSize == false) {
    return { buildNumber: latest.buildNumber };
  }

  return { buildNumber: latest.buildNumber, sizeBytes: size };
}

function storedBuildFields(latest: BuildArtifact | undefined): {
  buildNumber?: number;
  sizeBytes?: number;
} {
  if (isStoredArtifact(latest)) {
    return fieldsFromArtifact(latest);
  }

  return {};
}

function buildFailureEvent(
  prepared: PreparedBuild,
  buildOptions: BuildRunOptions,
  error: unknown,
): NotifyEvent {
  const isInternal = prepared.buildContext.distribution == 'internal';
  let eventName: NotifyEvent['event'] = 'build';
  const shouldNameSubmit = wantsStoreEvent(buildOptions.submit, isInternal);

  if (shouldNameSubmit) {
    eventName = 'submit';
  }

  let appVersion = prepared.app.version;

  if (appVersion == null) {
    appVersion = '0.0.0';
  }

  let failureText = String(error);

  if (hasMessage(error)) {
    failureText = error.message;
  }

  return {
    event: eventName,
    status: 'failure',
    app: prepared.app.name,
    platform: buildOptions.platform,
    version: appVersion,
    error: failureText,
  };
}

async function notifyBuildSuccess(
  prepared: PreparedBuild,
  buildOptions: BuildRunOptions,
): Promise<void> {
  const isDryRun = buildOptions.dryRun == true;

  if (isDryRun) {
    return;
  }

  const notificationEvent = await buildSuccessEvent(prepared, buildOptions);

  await notify(prepared.config, notificationEvent);
}

async function notifyBuildFailure(
  prepared: PreparedBuild,
  buildOptions: BuildRunOptions,
  error: unknown,
): Promise<void> {
  const isDryRun = buildOptions.dryRun == true;

  if (isDryRun) {
    return;
  }

  await notify(prepared.config, buildFailureEvent(prepared, buildOptions, error));
}

async function runLocalBuild(
  prepared: PreparedBuild,
  buildOptions: BuildRunOptions,
): Promise<void> {
  const isAndroid = prepared.buildContext.platform == 'android';

  if (isAndroid) {
    await runAndroidBuild(prepared, buildOptions);
    return;
  }

  await runIosBuild(prepared, buildOptions);
}

async function dispatchBuild(
  prepared: PreparedBuild,
  buildOptions: BuildRunOptions,
): Promise<void> {
  const choice = resolveBuildTransport(
    buildOptions.platform,
    prepared.config.buildEngine,
    buildOptions.remote,
  );

  switch (choice.kind) {
    case 'local':
      await runLocalBuild(prepared, buildOptions);
      return;
    case 'remote': {
      const remotePipeline = await import('./remote-pipeline.ts');

      await remotePipeline.runRemoteBuild(prepared, { ...buildOptions, remote: choice.remote });
      return;
    }
    case 'eas': {
      const easPipeline = await import('./eas-pipeline.ts');

      await easPipeline.runEasBuild(prepared, buildOptions);
      return;
    }
  }
}

/**
 * Run a build, then notify success. A failed step notifies the failure first, and that notify error
 * replaces the build error when it throws. Dry-runs never notify. `--print-env` stops before exclusions.
 */
export async function runBuild(buildOptions: BuildRunOptions): Promise<void> {
  const shouldPrintEnvironment = buildOptions.printEnv == true;

  if (shouldPrintEnvironment) {
    await previewEnv(buildOptions);
    return;
  }

  const prepared = await prepareBuild(buildOptions);
  let exclusions: readonly string[] = [];
  const configuredExclusions = prepared.config.envExclude;

  if (configuredExclusions != null) {
    exclusions = configuredExclusions;
  }

  setCommandEnvironmentExclusions(exclusions);

  try {
    try {
      await dispatchBuild(prepared, buildOptions);
      await notifyBuildSuccess(prepared, buildOptions);
    } catch (error) {
      await notifyBuildFailure(prepared, buildOptions, error);
      throw error;
    }
  } finally {
    setCommandEnvironmentExclusions([]);
  }
}
