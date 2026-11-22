import type { AccountRecord, AppleCredentials, BuildCredentials } from '../types/credentials.ts';
import type { SizeReport } from '../types/artifacts.ts';
import { makeProviderInputFailure } from '../types/providers.ts';
import type { BumpKind } from '../release/version.ts';
import { refreshIdentityIfStale } from '../credentials/accounts.ts';
import { getBuildEngine, getCredentialsProvider } from '../services/providerSupport/registry.ts';
import { rememberLastRun } from '../distribution/lastRun.ts';
import { withSpinner } from '../services/platform/progress.ts';
import { distributeArtifact } from '../distribution/distribute.ts';
import { type BuildRunOptions, type PreparedBuild, DRY_RUN_KEY } from './pipelineTypes.ts';
import { resolveBuildEngineName } from './pipelineProviders.ts';
import { resolveIosAccount, resolveSigning } from './pipelineSigning.ts';
import { nextBuildNumber, resolveMarketingVersion, setIosBuildNumber } from './pipelineVersion.ts';
import {
  ensureNativeProject,
  receiptDestination,
  renderReceipt,
  reportCcacheStats,
  reportProcessing,
  reportSize,
  resolveAscBuildLink,
  runBuildStep,
  storeArtifact,
  nudgeIfNoCcache,
  uploadIosBuild,
} from './pipelineArtifact.ts';
import type { Logger } from '../services/platform/logger.ts';
import type { AppDescriptor } from '../types/app.ts';

function isAppleBuildCredentials(
  credentials: BuildCredentials,
): credentials is BuildCredentials & AppleCredentials & { platform: 'ios' } {
  return credentials.platform == 'ios';
}

function requireAppleCredentials(
  credentials: BuildCredentials,
  providerName: string,
): BuildCredentials & AppleCredentials & { platform: 'ios' } {
  if (isAppleBuildCredentials(credentials)) {
    return credentials;
  }

  throw makeProviderInputFailure({
    provider: providerName,
    message: 'Expected Apple (App Store Connect) credentials for an Apple build.',
  });
}

function shouldSuggestMarketingVersion(shouldSubmit: boolean, isInternal: boolean): boolean {
  if (shouldSubmit == false) {
    return false;
  }

  return isInternal == false;
}

function shouldResolveStoreLink(shouldSubmit: boolean, bundleId: string): boolean {
  if (shouldSubmit == false) {
    return false;
  }

  return bundleId != '';
}

function marketingVersion(app: AppDescriptor): string {
  if (app.version == null) {
    return '0.0.0';
  }

  return app.version;
}

function bundleIdentifier(app: AppDescriptor): string {
  if (app.bundleId == null) {
    return '';
  }

  return app.bundleId;
}

async function readIosAccount(
  isDryRun: boolean,
  buildOptions: BuildRunOptions,
  log: Logger,
  buildContext: PreparedBuild['buildContext'],
): Promise<AccountRecord | undefined> {
  if (isDryRun) {
    return undefined;
  }

  const account = await resolveIosAccount(buildOptions, log);

  buildContext.account = account.keyId;

  return account;
}

async function readIosCredentials(
  isDryRun: boolean,
  launchConfig: PreparedBuild['config'],
  buildContext: PreparedBuild['buildContext'],
): Promise<BuildCredentials> {
  if (isDryRun) {
    return { platform: 'ios', ascKey: DRY_RUN_KEY };
  }

  const credentialsProvider = getCredentialsProvider(launchConfig.credentials);
  const resolved = await credentialsProvider.resolveBuildCredentials(buildContext);

  return resolved;
}

function iosBuildKind(cleanBuilt: boolean): string {
  if (cleanBuilt) {
    return 'clean (from scratch)';
  }

  return 'incremental (cache warm)';
}

function iosBuildDescription(isDryRun: boolean, cleanBuilt: boolean, artifactPath: string): string {
  if (isDryRun) {
    return 'skipped (dry-run)';
  }

  return `${iosBuildKind(cleanBuilt)} - ${artifactPath}`;
}

function finishDryRunNote(
  log: Logger,
  appName: string,
  appVersion: string,
  buildNumber: number,
): void {
  log.gap();
  log.note(`Done. ${appName} ${appVersion} (${buildNumber}) - dry-run, nothing changed`);
}

/** The iOS spine: prebuild, signing, build number, archive, size, store, then submit. */
export async function runIosBuild(
  prepared: PreparedBuild,
  buildOptions: BuildRunOptions,
): Promise<void> {
  const launchConfig = prepared.config;
  const app = prepared.app;
  const buildContext = prepared.buildContext;
  const log = prepared.log;
  const isDryRun = buildOptions.dryRun == true;
  const buildEngine = getBuildEngine(resolveBuildEngineName(launchConfig, 'ios'));
  const appVersion = marketingVersion(app);

  await ensureNativeProject(buildContext, log, launchConfig.prebuild);

  const account = await readIosAccount(isDryRun, buildOptions, log, buildContext);
  const loadedCredentials = await readIosCredentials(isDryRun, launchConfig, buildContext);
  const resolved = requireAppleCredentials(loadedCredentials, launchConfig.credentials);

  let credentialsDescription = `key ${resolved.ascKey.keyId}`;

  if (isDryRun) {
    credentialsDescription = 'dry-run (no key needed)';
  }

  log.step('credentials', credentialsDescription, 'asc-api-key');

  const signing = await resolveSigning(
    resolved,
    app,
    buildContext.platform,
    log,
    isDryRun,
    buildContext.distribution,
  );
  const credentials: BuildCredentials = { platform: 'ios', ascKey: resolved.ascKey, signing };
  const bundleId = bundleIdentifier(app);
  const isInternal = buildContext.distribution == 'internal';
  let resolvedBump: BumpKind | undefined;
  const shouldSuggestVersion = shouldSuggestMarketingVersion(buildOptions.submit, isInternal);

  if (shouldSuggestVersion) {
    resolvedBump = await resolveMarketingVersion(
      resolved.ascKey,
      bundleId,
      app,
      buildContext.platform,
      buildOptions,
      log,
    );
  }

  async function readNextBuildNumber(): Promise<number> {
    const buildNumber = await nextBuildNumber(resolved.ascKey, bundleId, isDryRun);

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

  let stamped = false;

  if (isDryRun == false) {
    stamped = await setIosBuildNumber(app.dir, buildContext.platform, buildNumber);
  }

  let buildNumberDescription = `${buildNumber} (could not stamp Info.plist)`;

  if (stamped) {
    buildNumberDescription = `set to ${buildNumber}`;
  }

  if (isDryRun) {
    buildNumberDescription = `would set next build number (~${buildNumber})`;
  }

  log.step('build number', buildNumberDescription, 'build-number');

  if (isDryRun == false) {
    await nudgeIfNoCcache(log);
  }

  const compiled = await runBuildStep(prepared, buildNumber, function compileArtifact() {
    return buildEngine.buildArtifact(buildContext, credentials);
  });

  log.step(
    'build',
    iosBuildDescription(isDryRun, compiled.cleanBuilt, compiled.artifactPath),
    'incremental-build',
  );

  if (isDryRun == false) {
    await reportCcacheStats(log);
  }

  await reportSize(compiled.sizeReport, log);
  await storeArtifact(
    prepared,
    compiled.artifactPath,
    buildNumber,
    compiled.sizeReport,
    compiled.cleanBuilt,
  );

  if (isInternal) {
    await finishInternalIosBuild(
      prepared,
      buildOptions,
      compiled.artifactPath,
      appVersion,
      buildNumber,
      bundleId,
      resolvedBump,
    );
    return;
  }

  await submitIosWhenRequested(
    prepared,
    buildOptions,
    compiled.artifactPath,
    appVersion,
    buildNumber,
    compiled.sizeReport,
    credentials,
    resolved.ascKey,
    bundleId,
  );

  if (isDryRun) {
    finishDryRunNote(log, app.name, appVersion, buildNumber);
    return;
  }

  const hasAccount = account != null;

  if (hasAccount) {
    await refreshIdentityIfStale(account, resolved.ascKey);
  }

  let link: string | undefined;
  const shouldLink = shouldResolveStoreLink(buildOptions.submit, bundleId);

  if (shouldLink) {
    link = await resolveAscBuildLink(resolved.ascKey, bundleId);
  }

  await renderReceipt({
    app,
    version: appVersion,
    buildNumber,
    report: compiled.sizeReport,
    destination: receiptDestination('ios', buildOptions),
    link,
    log,
  });
  await rememberLastRun(app.name, resolvedBump);
}

async function finishInternalIosBuild(
  prepared: PreparedBuild,
  buildOptions: BuildRunOptions,
  artifactPath: string,
  appVersion: string,
  buildNumber: number,
  bundleId: string,
  resolvedBump: BumpKind | undefined,
): Promise<void> {
  const isDryRun = buildOptions.dryRun == true;

  await distributeArtifact({
    config: prepared.config,
    app: prepared.app,
    platform: 'ios',
    artifactPath,
    version: appVersion,
    buildNumber,
    bundleId,
    dryRun: isDryRun,
    log: prepared.log,
  });

  if (isDryRun) {
    finishDryRunNote(prepared.log, prepared.app.name, appVersion, buildNumber);
    return;
  }

  await rememberLastRun(prepared.app.name, resolvedBump);
}

async function submitIosWhenRequested(
  prepared: PreparedBuild,
  buildOptions: BuildRunOptions,
  artifactPath: string,
  appVersion: string,
  buildNumber: number,
  sizeReport: SizeReport,
  credentials: BuildCredentials,
  ascKey: AppleCredentials['ascKey'],
  bundleId: string,
): Promise<void> {
  const shouldSubmit = buildOptions.submit == true;

  if (shouldSubmit == false) {
    return;
  }

  const isDryRun = buildOptions.dryRun == true;

  if (isDryRun) {
    prepared.log.step('submit', 'would upload to TestFlight', 'testflight');
    return;
  }

  await uploadIosBuild(
    prepared,
    buildOptions,
    { path: artifactPath, version: appVersion, buildNumber },
    sizeReport,
    credentials,
  );

  const hasBundleId = bundleId != '';

  if (hasBundleId == false) {
    return;
  }

  await reportProcessing(ascKey, bundleId, buildNumber, prepared.log);
}
