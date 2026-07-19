/**
 * The Android local build spine.
 *
 * prebuild → resolve service account + keystore → versionCode → gradle .aab → size → store → supply.
 */

import type { BuildCredentials } from '../types/index.js';
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

export async function runAndroidBuild(
  prepared: PreparedBuild,
  options: BuildRunOptions,
): Promise<void> {
  const { config, app, ctx, log } = prepared;
  const { dryRun } = options;
  const packageName = app.packageName;
  if (!packageName)
    throw new Error(`No Android application id for ${app.name}. Set android.package in app.json.`);

  // 2. Generate the native project only when it's missing (committed android/ is used as-is).
  await ensureAndroidProject(ctx, log);

  // 3. Resolve the Play service account, then reuse-or-provision the upload keystore.
  const resolved: BuildCredentials = dryRun
    ? { platform: 'android', serviceAccountJson: '' }
    : await getCredentialsProvider(config.credentials).resolve(ctx);
  if (resolved.platform !== 'android')
    throw new Error('Expected Android credentials for an Android build.');
  log.step(
    'credentials',
    dryRun ? 'dry-run (no service account needed)' : 'service account loaded',
    'service-account',
  );
  const keystore = await resolveKeystore(resolved, app, log, dryRun);
  const credentials: BuildCredentials = {
    platform: 'android',
    serviceAccountJson: resolved.serviceAccountJson,
    keystore,
  };

  // 4. Auto-bump the versionCode from the latest Google Play has on record (app.json as a floor).
  const versionCode = dryRun
    ? await nextVersionCode(
        resolved.serviceAccountJson,
        packageName,
        app.androidVersionCode ?? 0,
        dryRun,
      )
    : await withSpinner('Checking latest versionCode on Google Play', () =>
        nextVersionCode(
          resolved.serviceAccountJson,
          packageName,
          app.androidVersionCode ?? 0,
          dryRun,
        ),
      );
  const stamped = dryRun ? false : setAndroidVersionCode(app.dir, versionCode);
  log.step(
    'version code',
    dryRun
      ? `would set next versionCode (≈${versionCode})`
      : stamped
        ? `set to ${versionCode}`
        : `${versionCode} (could not stamp build.gradle)`,
    'version-code',
  );

  // 5. Compile, sign (upload key), export the .aab, and estimate the download with bundletool.
  const { artifactPath, sizeReport, cleanBuilt } = await runBuildStep(prepared, versionCode, () =>
    getBuildEngine(resolveBuildEngineName(config, 'android')).build(ctx, credentials),
  );
  log.step(
    'build',
    dryRun
      ? 'skipped (dry-run)'
      : `${cleanBuilt ? 'clean (from scratch)' : 'incremental (Gradle)'} · ${artifactPath}`,
    'incremental-build',
  );

  // 6. Show the size readout (bundletool estimate; the budget decision happens at the upload boundary).
  reportSize(sizeReport, log, 'bundletool');

  // 7. Store the artifact (shared with iOS).
  await storeArtifact(prepared, artifactPath, versionCode, sizeReport, cleanBuilt);

  // 8a. Internal distribution: skip the Play track — upload the .apk as a direct install link.
  if (ctx.distribution === 'internal') {
    await distributeArtifact({
      config,
      app,
      platform: 'android',
      artifactPath,
      version: app.version ?? '0.0.0',
      buildNumber: versionCode,
      dryRun,
      log,
    });
    if (dryRun) {
      log.gap();
      log.info(
        `Done. ${app.name} ${app.version ?? '0.0.0'} (${versionCode}) · dry-run, nothing changed`,
      );
    } else {
      rememberLastRun(app.name);
    }
    return;
  }

  // 8. Confirm the upload (size shown; budget enforced here), then submit via fastlane supply.
  const track = ctx.android?.track ?? 'internal';
  if (options.submit) {
    if (dryRun) {
      log.step('submit', `would upload to the ${track} track via fastlane supply`, 'play-track');
    } else {
      await confirmUpload({
        report: sizeReport,
        budgetMB: resolveSizeBudgetMB(options, prepared.profile),
        destination: `Google Play (${track} track)`,
        app,
        version: app.version ?? '0.0.0',
        buildNumber: versionCode,
        previous: await previousBuild(config, app, 'android', versionCode),
        yes: options.yes ?? false,
        log,
      });
      const stores = await submitToStores(
        config,
        'android',
        artifactPath,
        options.target,
        credentials,
        ctx,
      );
      log.step(
        'submit',
        stores.length > 1
          ? `uploaded to the ${track} track and ${stores.length - 1} more store(s)`
          : `uploaded to the ${track} track`,
        'play-track',
      );
    }
  }

  if (dryRun) {
    log.gap();
    log.info(
      `Done. ${app.name} ${app.version ?? '0.0.0'} (${versionCode}) · dry-run, nothing changed`,
    );
    return;
  }
  await renderReceipt({
    app,
    version: app.version ?? '0.0.0',
    buildNumber: versionCode,
    report: sizeReport,
    destination: receiptDestination('android', options, track),
    link: options.submit ? 'https://play.google.com/console' : undefined,
    log,
  });
  // Remember the app built so the next run's picker pre-selects it (Android has no marketing-bump prompt).
  rememberLastRun(app.name);
}
