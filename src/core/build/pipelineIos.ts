/**
 * The iOS (and other Apple platforms) local build spine.
 *
 * prebuild → resolve creds/signing → marketing version → build number → gym → size → store → submit.
 */

import type { AccountRecord, BuildCredentials } from '../types/index.js';
import type { BumpKind } from '../release/version.js';
import { refreshIdentityIfStale } from '../credentials/accounts.js';
import { getBuildEngine, getCredentialsProvider } from '../services/registry.js';
import { rememberLastRun } from '../distribution/lastRun.js';
import { withSpinner } from '../services/progress.js';
import { distributeArtifact } from '../distribution/distribute.js';
import { type BuildRunOptions, type PreparedBuild, DRY_RUN_KEY } from './pipelineTypes.js';
import {
  resolveBuildEngineName,
  resolveSizeBudgetMB,
  submitToStores,
} from './pipelineProviders.js';
import { resolveIosAccount, resolveSigning } from './pipelineSigning.js';
import { nextBuildNumber, resolveMarketingVersion, setIosBuildNumber } from './pipelineVersion.js';
import {
  confirmUpload,
  ensureNativeProject,
  previousBuild,
  receiptDestination,
  renderReceipt,
  reportCcacheStats,
  reportProcessing,
  reportSize,
  resolveAscBuildLink,
  runBuildStep,
  storeArtifact,
  nudgeIfNoCcache,
} from './pipelineArtifact.js';

/** The iOS spine: prebuild → resolve creds/signing → build number → gym → size → store → submit. */
export async function runIosBuild(
  prepared: PreparedBuild,
  options: BuildRunOptions,
): Promise<void> {
  const { config, app, ctx, log } = prepared;
  const { dryRun } = options;

  // 2. Generate the native project only when it's missing (bare/committed ios/ is used as-is).
  await ensureNativeProject(ctx, log);

  // 2.5. Resolve which Apple account to build with (skipped in dry-run, which uses the placeholder key).
  let account: AccountRecord | undefined;
  if (!dryRun) {
    account = await resolveIosAccount(options, log);
    ctx.account = account.keyId;
  }

  // 3. Resolve the API key, then reuse-or-provision the distribution cert + profile.
  const resolved: BuildCredentials = dryRun
    ? { platform: 'ios', ascKey: DRY_RUN_KEY }
    : await getCredentialsProvider(config.credentials).resolve(ctx);
  if (resolved.platform !== 'ios')
    throw new Error('Expected Apple (App Store Connect) credentials for an Apple build.');
  log.step(
    'credentials',
    dryRun ? 'dry-run (no key needed)' : `key ${resolved.ascKey.keyId}`,
    'asc-api-key',
  );
  const signing = await resolveSigning(resolved, app, ctx.platform, log, dryRun, ctx.distribution);
  const credentials: BuildCredentials = { platform: 'ios', ascKey: resolved.ascKey, signing };
  const bundleId = app.bundleId ?? '';
  const internal = ctx.distribution === 'internal';

  // 3b. Suggest the next marketing version from what's already on the store (interactive store uploads only —
  // an internal install-link build doesn't touch the store, so the store-version prompt is skipped). The
  // applied bump kind is remembered after a successful build (see the rememberLastRun calls below).
  let resolvedBump: BumpKind | undefined;
  if (options.submit && !internal) {
    resolvedBump = await resolveMarketingVersion(
      resolved.ascKey,
      bundleId,
      app,
      ctx.platform,
      options,
      log,
    );
  }

  // 4. Auto-bump the build number from the last one Apple has on record.
  const buildNumber = dryRun
    ? await nextBuildNumber(resolved.ascKey, bundleId, dryRun)
    : await withSpinner('Checking last build number on App Store Connect', () =>
        nextBuildNumber(resolved.ascKey, bundleId, dryRun),
      );
  const stamped = dryRun ? false : await setIosBuildNumber(app.dir, ctx.platform, buildNumber);
  log.step(
    'build number',
    dryRun
      ? `would set next build number (≈${buildNumber})`
      : stamped
        ? `set to ${buildNumber}`
        : `${buildNumber} (could not stamp Info.plist)`,
    'build-number',
  );

  // 5. Compile, sign, export, and analyze size — clean or incremental per the build fingerprint.
  if (!dryRun) await nudgeIfNoCcache(log);
  const { artifactPath, sizeReport, cleanBuilt } = await runBuildStep(prepared, buildNumber, () =>
    getBuildEngine(resolveBuildEngineName(config, 'ios')).build(ctx, credentials),
  );
  log.step(
    'build',
    dryRun
      ? 'skipped (dry-run)'
      : `${cleanBuilt ? 'clean (from scratch)' : 'incremental (cache warm)'} · ${artifactPath}`,
    'incremental-build',
  );
  if (!dryRun) await reportCcacheStats(log);

  // 6. Show the per-device size readout (the budget decision happens at the upload boundary).
  reportSize(sizeReport, log);

  // 7. Store the artifact (shared with Android).
  await storeArtifact(prepared, artifactPath, buildNumber, sizeReport, cleanBuilt);

  // 8a. Internal distribution: skip the store entirely — upload an ad-hoc install link instead.
  if (internal) {
    await distributeArtifact({
      config,
      app,
      platform: 'ios',
      artifactPath,
      version: app.version ?? '0.0.0',
      buildNumber,
      bundleId,
      dryRun,
      log,
    });
    if (dryRun) {
      log.gap();
      log.info(
        `Done. ${app.name} ${app.version ?? '0.0.0'} (${buildNumber}) · dry-run, nothing changed`,
      );
    } else {
      rememberLastRun(app.name, resolvedBump);
    }
    return;
  }

  // 8. Confirm the upload (size shown; budget enforced here), submit, then report processing status.
  const destination = options.target === 'testing' ? 'TestFlight' : 'App Store review';
  if (options.submit) {
    if (dryRun) {
      log.step('submit', `would upload to ${destination}`, 'testflight');
    } else {
      await confirmUpload({
        report: sizeReport,
        budgetMB: resolveSizeBudgetMB(options, prepared.profile),
        destination,
        app,
        version: app.version ?? '0.0.0',
        buildNumber,
        previous: await previousBuild(config, app, 'ios', buildNumber),
        yes: options.yes ?? false,
        log,
      });
      await submitToStores(config, 'ios', artifactPath, options.target, credentials, ctx);
      log.step(
        'submit',
        options.target === 'testing' ? 'uploaded to TestFlight' : 'submitted for App Store review',
        'testflight',
      );
      if (options.target === 'testing' && bundleId) {
        await reportProcessing(resolved.ascKey, bundleId, buildNumber, log);
      }
    }
  }

  if (dryRun) {
    log.gap();
    log.info(
      `Done. ${app.name} ${app.version ?? '0.0.0'} (${buildNumber}) · dry-run, nothing changed`,
    );
    return;
  }
  // Backfill this account's Team ID + app names from Apple the first time we have a live key in hand.
  if (account) await refreshIdentityIfStale(account, resolved.ascKey);
  const link =
    options.submit && bundleId
      ? await resolveAscBuildLink(resolved.ascKey, bundleId, options.target)
      : undefined;
  await renderReceipt({
    app,
    version: app.version ?? '0.0.0',
    buildNumber,
    report: sizeReport,
    destination: receiptDestination('ios', options),
    link,
    log,
  });
  // Remember this run's picks so the next build defaults to them (app pre-selected, bump auto-applied).
  rememberLastRun(app.name, resolvedBump);
}
