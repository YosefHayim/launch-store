// Checks the app, prepares one build, runs it, and reports when it finishes.

import { setCommandEnvironmentExclusions } from '../services/platform/execute-command.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { ResolvedBuildContext } from '../types/config.ts';
import type { MutableDeep } from '../types/mutable.ts';
import { loadConfig } from '../config/config.ts';
import { checkApp, formatFinding } from '../config/config-check.ts';
import { ENV_SOURCE } from '../config/environment-file.ts';
import { createLogger } from '../services/platform/logger.ts';
import type { BuildRunOptions, PreparedBuild } from '../types/build-run.ts';
import {
  resolveAndroidRelease,
  resolveAndroidSubmitReleaseNotes,
  resolveBuildTransport,
} from './pipeline-providers.ts';
import { resolveCommandEnv, selectApp, validateResolvedEnv } from './pipeline-environment.ts';
import { runIosBuild } from './pipeline-ios.ts';
import { runAndroidBuild } from './pipeline-android.ts';
import { hasMessage } from '../services/platform/error-message.ts';

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

  return ' - remote(ssh)';
}

async function attachAndroidRelease(
  preparedAppName: string,
  launchConfig: PreparedBuild['config'],
  buildOptions: BuildRunOptions,
  app: Pick<AppDescriptor, 'dir' | 'bundleId' | 'packageName'>,
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
      app,
      buildOptions.notesPath,
    );
  } catch (error) {
    const failureDetail = readFailureDetail(error);

    throw new Error(
      `Could not resolve Android release notes for ${preparedAppName}: ${failureDetail}`,
    );
  }

  const hasReleaseNotes = releaseNotes.length > 0;

  if (hasReleaseNotes) {
    androidRelease.releaseNotes = [...releaseNotes];
  }

  return { ...buildContext, android: androidRelease };
}

/** Resolve config, the chosen app, the profile, a validated env, a logger */
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
  const checked = await validateResolvedEnv(app.dir, resolved, log, launchConfig.envExclude ?? []);
  const environmentValues = checked.values;

  const secretCount = Object.values(checked.sources).filter(isSecretSource).length;
  const varCount = Object.keys(environmentValues).length;
  let keychainNote = '';

  if (secretCount > 0) {
    keychainNote = ` (${secretCount} from keychain)`;
  }

  log.step('env', `${varCount} vars validated${keychainNote}`, 'env-vars');

  const excludedCount = resolved.excluded.length;
  const hasExclusions = excludedCount > 0;

  if (hasExclusions) {
    log.tip(`excluded ${excludedCount} names (envExclude, not injected)`);
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

    throw new Error(`App config preflight failed for ${app.name}:\n${errorLines.join('\n')}`);
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
      app,
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
      const easPipeline = await import('./expo-application-services-pipeline.ts');

      await easPipeline.runEasBuild(prepared, buildOptions);
      return;
    }
  }
}

/** Run one prepared build. */
export async function runBuild(buildOptions: BuildRunOptions): Promise<void> {
  const prepared = await prepareBuild(buildOptions);
  let exclusions: readonly string[] = [];
  const configuredExclusions = prepared.config.envExclude;

  if (configuredExclusions != null) {
    exclusions = configuredExclusions;
  }

  setCommandEnvironmentExclusions(exclusions);

  try {
    await dispatchBuild(prepared, buildOptions);
  } finally {
    setCommandEnvironmentExclusions([]);
  }
}
