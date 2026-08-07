import { Effect } from 'effect';
import type { BuildCredentials } from '../types/credentials.js';
import { makeProviderInputFailure } from '../types/providers.js';
import { getBuildEngine, getCredentialsProvider } from '../services/registry.js';
import { rememberLastRun } from '../distribution/lastRun.js';
import { withSpinner } from '../services/progress.js';
import { distributeArtifact } from '../distribution/distribute.js';
import type { BuildRunOptions, PreparedBuild } from './pipelineTypes.js';
import {
  resolveBuildEngineName,
  resolveSizeBudgetMB,
  submitToStores,
} from './pipelineProviders.js';
import { resolveKeystore } from './pipelineSigning.js';
import { nextVersionCode, setAndroidVersionCode } from './pipelineVersion.js';
import {
  confirmUpload,
  ensureAndroidProject,
  previousBuild,
  receiptDestination,
  renderReceipt,
  reportSize,
  runBuildStep,
  storeArtifact,
} from './pipelineArtifact.js';
export const runAndroidBuild = (prepared: PreparedBuild, options: BuildRunOptions) =>
  Effect.gen(function* () {
    const { config, app, buildContext, log } = prepared;
    const { dryRun } = options;
    let appVersion = app.version;
    if (appVersion === undefined) appVersion = '0.0.0';
    const packageName = app.packageName;
    if (!packageName)
      return yield* Effect.fail(
        makeProviderInputFailure({
          provider: 'android-build',
          message: `No Android application id for ${app.name}. Set android.package in app.json.`,
        }),
      );
    // 2. Generate the native project only when it's missing (committed android/ is used as-is).
    yield* ensureAndroidProject(buildContext, log);
    // 3. Resolve the Play service account, then reuse-or-provision the upload keystore.
    let resolved: BuildCredentials = { platform: 'android', serviceAccountJson: '' };
    if (!dryRun) {
      const credentialsProvider = yield* getCredentialsProvider(config.credentials);
      resolved = yield* credentialsProvider.resolveBuildCredentials(buildContext);
    }
    if (resolved.platform !== 'android') {
      return yield* Effect.fail(
        makeProviderInputFailure({
          provider: config.credentials,
          message: 'Expected Android credentials for an Android build.',
        }),
      );
    }
    let credentialsDescription = 'service account loaded';
    if (dryRun) credentialsDescription = 'dry-run (no service account needed)';
    yield* log.step('credentials', credentialsDescription, 'service-account');
    const keystore = yield* resolveKeystore(resolved, app, log, dryRun);
    const credentials: BuildCredentials = {
      platform: 'android',
      serviceAccountJson: resolved.serviceAccountJson,
      keystore,
    };
    // 4. Auto-bump the versionCode from the latest Google Play has on record (app.json as a floor).
    let versionCode: number;
    let configuredVersionCode = app.androidVersionCode;
    if (configuredVersionCode === undefined) configuredVersionCode = 0;
    if (dryRun) {
      versionCode = yield* nextVersionCode(
        resolved.serviceAccountJson,
        packageName,
        configuredVersionCode,
        dryRun,
      );
    } else {
      versionCode = yield* withSpinner('Checking latest versionCode on Google Play', () =>
        nextVersionCode(resolved.serviceAccountJson, packageName, configuredVersionCode, dryRun),
      );
    }
    let stamped = false;
    if (!dryRun) stamped = yield* setAndroidVersionCode(app.dir, versionCode);
    let versionCodeDescription = `${versionCode} (could not stamp build.gradle)`;
    if (stamped) versionCodeDescription = `set to ${versionCode}`;
    if (dryRun) versionCodeDescription = `would set next versionCode (~${versionCode})`;
    yield* log.step('version code', versionCodeDescription, 'version-code');
    // 5. Compile, sign (upload key), export the .aab, and estimate the download with bundletool.
    const buildEngine = yield* getBuildEngine(resolveBuildEngineName(config, 'android'));
    const { artifactPath, sizeReport, cleanBuilt } = yield* runBuildStep(
      prepared,
      versionCode,
      () => buildEngine.buildArtifact(buildContext, credentials),
    );
    let buildDescription = 'skipped (dry-run)';
    if (!dryRun) {
      let buildKind = 'incremental (Gradle)';
      if (cleanBuilt) buildKind = 'clean (from scratch)';
      buildDescription = `${buildKind} - ${artifactPath}`;
    }
    yield* log.step('build', buildDescription, 'incremental-build');
    // 6. Show the size readout (bundletool estimate; the budget decision happens at the upload boundary).
    yield* reportSize(sizeReport, log, 'bundletool');
    // 7. Store the artifact (shared with iOS).
    yield* storeArtifact(prepared, artifactPath, versionCode, sizeReport, cleanBuilt);
    // 8a. Internal distribution: skip the Play track - upload the .apk as a direct install link.
    if (buildContext.distribution === 'internal') {
      yield* distributeArtifact({
        config,
        app,
        platform: 'android',
        artifactPath,
        version: appVersion,
        buildNumber: versionCode,
        dryRun,
        log,
      });
      if (dryRun) {
        yield* log.gap();
        yield* log.note(
          `Done. ${app.name} ${appVersion} (${versionCode}) - dry-run, nothing changed`,
        );
      } else {
        yield* rememberLastRun(app.name);
      }
      return;
    }
    // 8. Confirm the upload (size shown; budget enforced here), then submit via fastlane supply.
    let track = buildContext.android?.track;
    if (track === undefined) track = 'internal';
    if (options.submit) {
      const releaseNotes = buildContext.android?.releaseNotes;
      let notesDescription = '';
      if (releaseNotes !== undefined && releaseNotes.length > 0) {
        notesDescription = ` with ${releaseNotes.length} locale release note(s)`;
      }
      if (dryRun) {
        yield* log.step(
          'submit',
          `would upload to the ${track} track via fastlane supply${notesDescription}`,
          'play-track',
        );
      } else {
        yield* confirmUpload({
          report: sizeReport,
          budgetMB: resolveSizeBudgetMB(options, prepared.profile),
          destination: `Google Play (${track} track)`,
          app,
          version: appVersion,
          buildNumber: versionCode,
          previous: yield* previousBuild(config, app, 'android', versionCode),
          yes: options.yes === true,
          log,
        });
        const stores = yield* submitToStores(
          config,
          'android',
          artifactPath,
          options.target,
          credentials,
          buildContext,
        );
        let submissionDescription = `uploaded to the ${track} track${notesDescription}`;
        if (stores.length > 1) {
          submissionDescription = `uploaded to the ${track} track and ${stores.length - 1} more store(s)${notesDescription}`;
        }
        yield* log.step('submit', submissionDescription, 'play-track');
      }
    }
    if (dryRun) {
      yield* log.gap();
      yield* log.note(
        `Done. ${app.name} ${appVersion} (${versionCode}) - dry-run, nothing changed`,
      );
      return;
    }
    let storeLink: string | undefined;
    if (options.submit) storeLink = 'https://play.google.com/console';
    yield* renderReceipt({
      app,
      version: appVersion,
      buildNumber: versionCode,
      report: sizeReport,
      destination: receiptDestination('android', options, track),
      link: storeLink,
      log,
    });
    // Remember the app built so the next run's picker pre-selects it (Android has no marketing-bump prompt).
    yield* rememberLastRun(app.name);
  });
