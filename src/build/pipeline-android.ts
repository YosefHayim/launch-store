import type { AndroidCredentials, BuildCredentials } from '../types/credentials.ts';
import { makeProviderInputFailure } from '../types/providers.ts';
import { getBuildEngine, getCredentialsProvider } from '../services/provider-support/registry.ts';
import { rememberLastRun } from '../distribution/last-run.ts';
import { withSpinner } from '../services/platform/progress.ts';
import { distributeArtifact } from '../distribution/distribute.ts';
import type { BuildRunOptions, PreparedBuild } from './pipeline-types.ts';
import {
  resolveBuildEngineName,
  resolveSizeBudgetMB,
  submitToStores,
} from './pipeline-providers.ts';
import { resolveKeystore } from './pipeline-signing.ts';
import { nextVersionCode, setAndroidVersionCode } from './pipeline-version.ts';
import {
  confirmUpload,
  ensureAndroidProject,
  previousBuild,
  receiptDestination,
  renderReceipt,
  reportSize,
  runBuildStep,
  storeArtifact,
} from './pipeline-artifact.ts';
import type { Logger } from '../services/platform/logger.ts';
import type { AndroidReleaseNote, AppDescriptor, PlayTrack } from '../types/app.ts';
import type { SizeReport } from '../types/artifacts.ts';

function isAndroidBuildCredentials(
  credentials: BuildCredentials,
): credentials is BuildCredentials & AndroidCredentials & { platform: 'android' } {
  return credentials.platform == 'android';
}

function requireAndroidCredentials(
  credentials: BuildCredentials,
  providerName: string,
): BuildCredentials & AndroidCredentials & { platform: 'android' } {
  if (isAndroidBuildCredentials(credentials)) {
    return credentials;
  }

  throw makeProviderInputFailure({
    provider: providerName,
    message: 'Expected Android credentials for an Android build.',
  });
}

function marketingVersion(app: AppDescriptor): string {
  if (app.version == null) {
    return '0.0.0';
  }

  return app.version;
}

function isPresentPackageName(packageName: string | undefined): packageName is string {
  if (packageName == null) {
    return false;
  }

  return packageName != '';
}

function requirePackageName(app: AppDescriptor): string {
  const packageName = app.packageName;

  if (isPresentPackageName(packageName)) {
    return packageName;
  }

  throw makeProviderInputFailure({
    provider: 'android-build',
    message: `No Android application id for ${app.name}. Set android.package in app.json.`,
  });
}

function configuredVersionCode(app: AppDescriptor): number {
  if (app.androidVersionCode == null) {
    return 0;
  }

  return app.androidVersionCode;
}

function androidBuildKind(cleanBuilt: boolean): string {
  if (cleanBuilt) {
    return 'clean (from scratch)';
  }

  return 'incremental (Gradle)';
}

function androidBuildDescription(
  isDryRun: boolean,
  cleanBuilt: boolean,
  artifactPath: string,
): string {
  if (isDryRun) {
    return 'skipped (dry-run)';
  }

  return `${androidBuildKind(cleanBuilt)} - ${artifactPath}`;
}

function finishDryRunNote(
  log: Logger,
  appName: string,
  appVersion: string,
  versionCode: number,
): void {
  log.gap();
  log.note(`Done. ${appName} ${appVersion} (${versionCode}) - dry-run, nothing changed`);
}

function hasReleaseNotes(
  releaseNotes: readonly AndroidReleaseNote[] | undefined,
): releaseNotes is readonly AndroidReleaseNote[] {
  if (releaseNotes == null) {
    return false;
  }

  return releaseNotes.length > 0;
}

function notesDescriptionFor(releaseNotes: readonly AndroidReleaseNote[] | undefined): string {
  if (hasReleaseNotes(releaseNotes)) {
    return ` with ${releaseNotes.length} locale release note(s)`;
  }

  return '';
}

async function readAndroidCredentials(
  isDryRun: boolean,
  launchConfig: PreparedBuild['config'],
  buildContext: PreparedBuild['buildContext'],
): Promise<BuildCredentials> {
  if (isDryRun) {
    return { platform: 'android', serviceAccountJson: '' };
  }

  const credentialsProvider = getCredentialsProvider(launchConfig.credentials);
  const resolved = await credentialsProvider.resolveBuildCredentials(buildContext);

  return resolved;
}

/** The Android spine: prebuild, keystore, versionCode, bundle, size, store, then Play submit. */
export async function runAndroidBuild(
  prepared: PreparedBuild,
  buildOptions: BuildRunOptions,
): Promise<void> {
  const launchConfig = prepared.config;
  const app = prepared.app;
  const buildContext = prepared.buildContext;
  const log = prepared.log;
  const isDryRun = buildOptions.dryRun == true;
  const appVersion = marketingVersion(app);
  const packageName = requirePackageName(app);
  const buildEngine = getBuildEngine(resolveBuildEngineName(launchConfig, 'android'));

  await ensureAndroidProject(buildContext, log, launchConfig.prebuild);

  const loadedCredentials = await readAndroidCredentials(isDryRun, launchConfig, buildContext);
  const resolved = requireAndroidCredentials(loadedCredentials, launchConfig.credentials);
  let credentialsDescription = 'service account loaded';

  if (isDryRun) {
    credentialsDescription = 'dry-run (no service account needed)';
  }

  log.step('credentials', credentialsDescription, 'service-account');

  const keystore = await resolveKeystore(resolved, app, log, isDryRun);
  const credentials: BuildCredentials = {
    platform: 'android',
    serviceAccountJson: resolved.serviceAccountJson,
    keystore,
  };
  const floor = configuredVersionCode(app);

  async function readNextVersionCode(): Promise<number> {
    const versionCode = await nextVersionCode(
      resolved.serviceAccountJson,
      packageName,
      floor,
      isDryRun,
    );

    return versionCode;
  }

  const versionCode = await chooseVersionCode(isDryRun, readNextVersionCode);
  let stamped = false;

  if (isDryRun == false) {
    stamped = await setAndroidVersionCode(app.dir, versionCode);
  }

  log.step('version code', versionCodeDescription(isDryRun, stamped, versionCode), 'version-code');

  const compiled = await runBuildStep(prepared, versionCode, function compileArtifact() {
    return buildEngine.buildArtifact(buildContext, credentials);
  });

  log.step(
    'build',
    androidBuildDescription(isDryRun, compiled.cleanBuilt, compiled.artifactPath),
    'incremental-build',
  );
  await reportSize(compiled.sizeReport, log, 'bundletool');
  await storeArtifact(
    prepared,
    compiled.artifactPath,
    versionCode,
    compiled.sizeReport,
    compiled.cleanBuilt,
  );

  const isInternal = buildContext.distribution == 'internal';

  if (isInternal) {
    await finishInternalAndroidBuild(
      prepared,
      isDryRun,
      compiled.artifactPath,
      appVersion,
      versionCode,
    );
    return;
  }

  let track = buildContext.android?.track;

  if (track == null) {
    track = 'internal';
  }

  await submitAndroidWhenRequested(
    prepared,
    buildOptions,
    compiled.artifactPath,
    appVersion,
    versionCode,
    compiled.sizeReport,
    credentials,
    track,
  );

  if (isDryRun) {
    finishDryRunNote(log, app.name, appVersion, versionCode);
    return;
  }

  let storeLink: string | undefined;

  if (buildOptions.submit) {
    storeLink = 'https://play.google.com/console';
  }

  await renderReceipt({
    app,
    version: appVersion,
    buildNumber: versionCode,
    report: compiled.sizeReport,
    destination: receiptDestination('android', buildOptions, track),
    link: storeLink,
    log,
  });
  await rememberLastRun(app.name);
}

async function chooseVersionCode(
  isDryRun: boolean,
  readNextVersionCode: () => Promise<number>,
): Promise<number> {
  if (isDryRun) {
    const dryRunCode = await readNextVersionCode();

    return dryRunCode;
  }

  const liveCode = await withSpinner(
    'Checking latest versionCode on Google Play',
    readNextVersionCode,
  );

  return liveCode;
}

function versionCodeDescription(isDryRun: boolean, stamped: boolean, versionCode: number): string {
  if (isDryRun) {
    return `would set next versionCode (~${versionCode})`;
  }

  if (stamped) {
    return `set to ${versionCode}`;
  }

  return `${versionCode} (could not stamp build.gradle)`;
}

async function finishInternalAndroidBuild(
  prepared: PreparedBuild,
  isDryRun: boolean,
  artifactPath: string,
  appVersion: string,
  versionCode: number,
): Promise<void> {
  await distributeArtifact({
    config: prepared.config,
    app: prepared.app,
    platform: 'android',
    artifactPath,
    version: appVersion,
    buildNumber: versionCode,
    dryRun: isDryRun,
    log: prepared.log,
  });

  if (isDryRun) {
    finishDryRunNote(prepared.log, prepared.app.name, appVersion, versionCode);
    return;
  }

  await rememberLastRun(prepared.app.name);
}

async function submitAndroidWhenRequested(
  prepared: PreparedBuild,
  buildOptions: BuildRunOptions,
  artifactPath: string,
  appVersion: string,
  versionCode: number,
  sizeReport: SizeReport,
  credentials: BuildCredentials,
  track: PlayTrack,
): Promise<void> {
  const shouldSubmit = buildOptions.submit == true;

  if (shouldSubmit == false) {
    return;
  }

  const releaseNotes = prepared.buildContext.android?.releaseNotes;
  const notesDescription = notesDescriptionFor(releaseNotes);
  const isDryRun = buildOptions.dryRun == true;

  if (isDryRun) {
    prepared.log.step(
      'submit',
      `would upload to the ${track} track via the Google Play API${notesDescription}`,
      'play-track',
    );
    return;
  }

  const priorBuild = await previousBuild(prepared.config, prepared.app, 'android', versionCode);

  await confirmUpload({
    report: sizeReport,
    budgetMB: resolveSizeBudgetMB(buildOptions, prepared.profile),
    destination: `Google Play (${track} track)`,
    app: prepared.app,
    version: appVersion,
    buildNumber: versionCode,
    previous: priorBuild,
    yes: buildOptions.yes == true,
    log: prepared.log,
  });

  const stores = await submitToStores(
    prepared.config,
    'android',
    { path: artifactPath, version: appVersion, buildNumber: versionCode },
    credentials,
    prepared.buildContext,
  );
  let submissionDescription = `uploaded to the ${track} track${notesDescription}`;
  const hasExtraStores = stores.length > 1;

  if (hasExtraStores) {
    submissionDescription = `uploaded to the ${track} track and ${stores.length - 1} more store(s)${notesDescription}`;
  }

  prepared.log.step('submit', submissionDescription, 'play-track');
}
