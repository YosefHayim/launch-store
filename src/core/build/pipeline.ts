/**
 * The build → submit pipeline: the linear spine that runs every step in order and is the only
 * place that knows the whole flow. Each step is a clean labelled line (expanded by `--explain`),
 * and the providers it calls are selected by name from config, so swapping infrastructure never
 * touches this file.
 *
 * `--dry-run` rehearses the entire flow — printing each step and the work it WOULD do — without a
 * network call, a build, or any change to your account, so it runs on a machine with no API key.
 *
 * Phase bodies live in sibling modules under `src/core/build/` (`pipelineIos`, `pipelineAndroid`,
 * `pipelineSigning`, `pipelineArtifact`, …). This file owns prepare → dispatch orchestration and
 * re-exports the public surface other packages import from `pipeline.js`.
 */

import type { ResolvedBuildContext } from '../types/index.js';
import type { NotifyEvent } from '../services/notify.js';
import { notify } from '../services/notify.js';
import { loadConfig } from '../config/config.js';
import { checkApp, formatFinding } from '../config/configCheck.js';
import { ENV_SOURCE, envInjectionRows } from '../config/env.js';
import { createLogger } from '../services/logger.js';
import { resolveStorageProvider } from '../distribution/storage.js';
import type { BuildRunOptions, PreparedBuild } from './pipelineTypes.js';
import { resolveAndroidRelease, resolveBuildTransport } from './pipelineProviders.js';
import { previewEnv, resolveCommandEnv, selectApp, validateResolvedEnv } from './pipelineEnv.js';
import { receiptDestination, worstDownloadBytes } from './pipelineArtifact.js';
import { runIosBuild } from './pipelineIos.js';
import { runAndroidBuild } from './pipelineAndroid.js';

export type {
  BuildRunOptions,
  PreparedBuild,
  BuildTransport,
  BuildTransportChoice,
  BumpResolution,
  ConfirmUploadOptions,
  BuildOutput,
  ReceiptOptions,
} from './pipelineTypes.js';
export { DRY_RUN_KEY, DEFAULT_SIZE_BUDGET_MB } from './pipelineTypes.js';
export {
  mb,
  resolveAndroidRelease,
  resolveBuildEngineName,
  resolveBuildTransport,
  resolveSizeBudgetMB,
  resolveSubmitterName,
  resolveSubmitters,
  submitToStores,
} from './pipelineProviders.js';
export { resolveCommandEnv, selectApp, validateResolvedEnv } from './pipelineEnv.js';
export { interactiveConfirm, resolveIosAccount } from './pipelineSigning.js';
export { nextBuildNumber, nextVersionCode, resolveBumpKind } from './pipelineVersion.js';
export {
  confirmUpload,
  receiptDestination,
  renderReceipt,
  reportProcessing,
  reportSize,
  resolveAscBuildLink,
  sizeSummary,
  uploadSizeReadout,
  worstDownloadBytes,
  previousBuild,
} from './pipelineArtifact.js';

/**
 * Resolve the shared front half of a build: config, the chosen app, the profile, a validated env, a
 * logger, and the {@link ResolvedBuildContext}. Identical for iOS and Android — every build path
 * (local, remote, EAS) starts here so app selection and env validation never drift; the platforms
 * diverge only in HOW they build (see {@link runIosBuild} / {@link runAndroidBuild}).
 */
export async function prepareBuild(options: BuildRunOptions): Promise<PreparedBuild> {
  const { dryRun, platform } = options;
  const log = createLogger(options.explain);

  const { config, apps } = await loadConfig();
  const app = await selectApp(apps, options.appName);
  const profile = config.profiles[options.profileName] ?? {
    name: options.profileName,
    sizeBudgetMB: 200,
  };
  const remoteSuffix = options.remote
    ? options.remote.kind === 'aws'
      ? ' · remote(aws)'
      : ' · remote(ssh)'
    : '';
  log.step(
    'config',
    `${log.chip(app.name)} · ${profile.name} · ${platform}${dryRun ? ' · dry-run' : ''}${remoteSuffix}`,
  );

  // Resolve + validate env before any expensive work, so a missing/secret-looking key fails fast.
  const resolved = await resolveCommandEnv({
    app,
    profile,
    cliEnv: options.envOverrides,
    includeLocal: options.includeLocal,
    envExclude: config.envExclude,
  });
  const env = resolved.values;
  validateResolvedEnv(app.dir, resolved, log, config.envExclude);
  const secretCount = Object.values(resolved.sources).filter(
    (source) => source === ENV_SOURCE.secret,
  ).length;
  const varCount = Object.keys(env).length;
  const keychainNote = secretCount > 0 ? ` (${secretCount} from keychain)` : '';
  // The count summary, then one provenance row per var (KEY → source, no values) so a run visibly
  // confirms every layer reaches the bundle step — local iOS used to drop everything above `.env`.
  log.step(
    'env',
    `${varCount} vars validated${keychainNote}${varCount > 0 ? ' → injecting into bundle:' : ''}`,
    'env-vars',
  );
  for (const row of envInjectionRows(resolved)) log.info(row);
  if (resolved.excluded.length > 0) {
    log.tip(`excluded (envExclude, not injected): ${resolved.excluded.join(', ')}`);
  }

  // Preflight the app config against known native-config footguns, before any expensive native work.
  // Warnings are surfaced; a build-breaking error (an invalid bundle id / package, a splash with no
  // backgroundColor) hard-stops here rather than failing deep inside xcodebuild/gradle minutes later.
  const findings = await checkApp(app, platform);
  for (const finding of findings) {
    if (finding.severity === 'warn') log.warn(formatFinding(finding));
  }
  const configErrors = findings.filter((finding) => finding.severity === 'error');
  if (configErrors.length > 0) {
    throw new Error(
      `App config preflight failed for ${app.name}:\n` +
        configErrors.map((finding) => `  ✗ ${formatFinding(finding)}`).join('\n'),
    );
  }
  log.step('config check', findings.length > 0 ? `${findings.length} warning(s)` : 'no footguns');

  const android = platform === 'android' ? resolveAndroidRelease(options, profile) : undefined;
  const ctx: ResolvedBuildContext = {
    platform,
    app,
    profile,
    env,
    explain: options.explain,
    dryRun,
    forceClean: options.forceClean ?? false,
    ...(options.ccache === undefined ? {} : { ccache: options.ccache }),
    ...(android ? { android } : {}),
    ...(options.distribution ? { distribution: options.distribution } : {}),
  };
  return { config, app, profile, env, ctx, log };
}

/**
 * Run a build, then fire any configured completion notification. Throws with a clear message on any
 * failed step — but first notifies the failure, so an unattended/CI build pings on both outcomes.
 * Dry-runs never notify (they change nothing). See {@link dispatchBuild} for the path selection.
 */
export async function runBuild(options: BuildRunOptions): Promise<void> {
  if (options.printEnv) {
    await previewEnv(options);
    return;
  }
  const prepared = await prepareBuild(options);
  try {
    await dispatchBuild(prepared, options);
    if (!options.dryRun) await notify(prepared.config, await buildSuccessEvent(prepared, options));
  } catch (error) {
    if (!options.dryRun) await notify(prepared.config, buildFailureEvent(prepared, options, error));
    throw error;
  }
}

/**
 * Select the build fork via {@link resolveBuildTransport}, then invoke that adapter.
 * The remote / EAS modules are imported lazily so a local-only build never loads the host or Expo code paths.
 */
async function dispatchBuild(prepared: PreparedBuild, options: BuildRunOptions): Promise<void> {
  const choice = resolveBuildTransport(
    options.platform,
    prepared.config.buildEngine,
    options.remote,
  );
  switch (choice.kind) {
    case 'local':
      return runLocalBuild(prepared, options);
    case 'remote': {
      const { runRemoteBuild } = await import('./remotePipeline.js');
      return runRemoteBuild(prepared, { ...options, remote: choice.remote });
    }
    case 'eas': {
      const { runEasBuild } = await import('./easPipeline.js');
      return runEasBuild(prepared, options);
    }
  }
}

/**
 * The success {@link NotifyEvent} for a finished run, read back from the artifact just stored (the
 * source of truth for the build number + size). `event` is `submit` once a store upload happened, else
 * `build` (a `--no-submit` or internal install-link run). Falls back to the app's config version when
 * no stored artifact is found (e.g. a remote/EAS path that stores elsewhere).
 */
async function buildSuccessEvent(
  prepared: PreparedBuild,
  options: BuildRunOptions,
): Promise<NotifyEvent> {
  const { config, app, ctx } = prepared;
  const internal = ctx.distribution === 'internal';
  const latest = (await resolveStorageProvider(config).list()).find(
    (artifact) => artifact.appName === app.name && artifact.platform === options.platform,
  );
  const event: NotifyEvent = {
    event: options.submit && !internal ? 'submit' : 'build',
    status: 'success',
    app: app.name,
    platform: options.platform,
    version: latest?.version ?? app.version ?? '0.0.0',
    destination: internal
      ? 'internal install link'
      : receiptDestination(options.platform, options, ctx.android?.track),
  };
  if (latest) {
    event.buildNumber = latest.buildNumber;
    const size = worstDownloadBytes(latest.sizeReport);
    if (size > 0) event.sizeBytes = size;
  }
  return event;
}

/** The failure {@link NotifyEvent} for a run that threw, carrying the error message and what's known. */
function buildFailureEvent(
  prepared: PreparedBuild,
  options: BuildRunOptions,
  error: unknown,
): NotifyEvent {
  const internal = prepared.ctx.distribution === 'internal';
  return {
    event: options.submit && !internal ? 'submit' : 'build',
    status: 'failure',
    app: prepared.app.name,
    platform: options.platform,
    version: prepared.app.version ?? '0.0.0',
    error: error instanceof Error ? error.message : String(error),
  };
}

/** The local spine: fork by platform after the shared front (prepareBuild) and before the shared tail. */
async function runLocalBuild(prepared: PreparedBuild, options: BuildRunOptions): Promise<void> {
  return prepared.ctx.platform === 'android'
    ? runAndroidBuild(prepared, options)
    : runIosBuild(prepared, options);
}
