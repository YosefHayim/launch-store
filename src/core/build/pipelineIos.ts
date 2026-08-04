import { Effect } from 'effect';
import type { AccountRecord, BuildCredentials } from '../types/credentials.js';
import { makeProviderInputFailure } from '../types/providers.js';
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
/** The iOS spine: prebuild -> resolve creds/signing -> build number -> gym -> size -> store -> submit. */
export const runIosBuild = (prepared: PreparedBuild, options: BuildRunOptions) =>
  Effect.gen(function* () {
    const { config, app, buildContext, log } = prepared;
    const { dryRun } = options;
    let appVersion = app.version;
    if (appVersion === undefined) appVersion = '0.0.0';
    // 2. Generate the native project only when it's missing (bare/committed ios/ is used as-is).
    yield* ensureNativeProject(buildContext, log);
    // 2.5. Resolve which Apple account to build with (skipped in dry-run, which uses the placeholder key).
    let account: AccountRecord | undefined;
    if (!dryRun) {
      account = yield* resolveIosAccount(options, log);
      buildContext.account = account.keyId;
    }
    // 3. Resolve the API key, then reuse-or-provision the distribution cert + profile.
    let resolved: BuildCredentials = { platform: 'ios', ascKey: DRY_RUN_KEY };
    if (!dryRun) {
      const credentialsProvider = yield* getCredentialsProvider(config.credentials);
      resolved = yield* credentialsProvider.resolveBuildCredentials(buildContext);
    }
    if (resolved.platform !== 'ios') {
      return yield* Effect.fail(
        makeProviderInputFailure({
          provider: config.credentials,
          message: 'Expected Apple (App Store Connect) credentials for an Apple build.',
        }),
      );
    }
    let credentialsDescription = `key ${resolved.ascKey.keyId}`;
    if (dryRun) credentialsDescription = 'dry-run (no key needed)';
    yield* log.step('credentials', credentialsDescription, 'asc-api-key');
    const signing = yield* resolveSigning(
      resolved,
      app,
      buildContext.platform,
      log,
      dryRun,
      buildContext.distribution,
    );
    const credentials: BuildCredentials = { platform: 'ios', ascKey: resolved.ascKey, signing };
    let bundleId = app.bundleId;
    if (bundleId === undefined) bundleId = '';
    const internal = buildContext.distribution === 'internal';
    // 3b. Suggest the next marketing version from what's already on the store (interactive store uploads only -
    // an internal install-link build doesn't touch the store, so the store-version prompt is skipped). The
    // applied bump kind is remembered after a successful build (see the rememberLastRun calls below).
    let resolvedBump: BumpKind | undefined;
    if (options.submit && !internal) {
      resolvedBump = yield* resolveMarketingVersion(
        resolved.ascKey,
        bundleId,
        app,
        buildContext.platform,
        options,
        log,
      );
    }
    // 4. Auto-bump the build number from the last one Apple has on record.
    let buildNumber: number;
    if (dryRun) {
      buildNumber = yield* nextBuildNumber(resolved.ascKey, bundleId, dryRun);
    } else {
      buildNumber = yield* withSpinner('Checking last build number on App Store Connect', () =>
        nextBuildNumber(resolved.ascKey, bundleId, dryRun),
      );
    }
    let stamped = false;
    if (!dryRun) {
      stamped = yield* setIosBuildNumber(app.dir, buildContext.platform, buildNumber);
    }
    let buildNumberDescription = `${buildNumber} (could not stamp Info.plist)`;
    if (stamped) buildNumberDescription = `set to ${buildNumber}`;
    if (dryRun) buildNumberDescription = `would set next build number (~${buildNumber})`;
    yield* log.step('build number', buildNumberDescription, 'build-number');
    // 5. Compile, sign, export, and analyze size - clean or incremental per the build fingerprint.
    if (!dryRun) yield* nudgeIfNoCcache(log);
    const buildEngine = yield* getBuildEngine(resolveBuildEngineName(config, 'ios'));
    const { artifactPath, sizeReport, cleanBuilt } = yield* runBuildStep(
      prepared,
      buildNumber,
      () => buildEngine.buildArtifact(buildContext, credentials),
    );
    let buildDescription = 'skipped (dry-run)';
    if (!dryRun) {
      let buildKind = 'incremental (cache warm)';
      if (cleanBuilt) buildKind = 'clean (from scratch)';
      buildDescription = `${buildKind} - ${artifactPath}`;
    }
    yield* log.step('build', buildDescription, 'incremental-build');
    if (!dryRun) yield* reportCcacheStats(log);
    // 6. Show the per-device size readout (the budget decision happens at the upload boundary).
    yield* reportSize(sizeReport, log);
    // 7. Store the artifact (shared with Android).
    yield* storeArtifact(prepared, artifactPath, buildNumber, sizeReport, cleanBuilt);
    // 8a. Internal distribution: skip the store entirely - upload an ad-hoc install link instead.
    if (internal) {
      yield* distributeArtifact({
        config,
        app,
        platform: 'ios',
        artifactPath,
        version: appVersion,
        buildNumber,
        bundleId,
        dryRun,
        log,
      });
      if (dryRun) {
        yield* log.gap();
        yield* log.note(
          `Done. ${app.name} ${appVersion} (${buildNumber}) - dry-run, nothing changed`,
        );
      } else {
        yield* rememberLastRun(app.name, resolvedBump);
      }
      return;
    }
    // 8. Confirm the upload (size shown; budget enforced here), submit, then report processing status.
    let destination = 'App Store review';
    if (options.target === 'testing') destination = 'TestFlight';
    if (options.submit) {
      if (dryRun) {
        yield* log.step('submit', `would upload to ${destination}`, 'testflight');
      } else {
        yield* confirmUpload({
          report: sizeReport,
          budgetMB: resolveSizeBudgetMB(options, prepared.profile),
          destination,
          app,
          version: appVersion,
          buildNumber,
          previous: yield* previousBuild(config, app, 'ios', buildNumber),
          yes: options.yes === true,
          log,
        });
        yield* submitToStores(
          config,
          'ios',
          artifactPath,
          options.target,
          credentials,
          buildContext,
        );
        let submissionDescription = 'submitted for App Store review';
        if (options.target === 'testing') submissionDescription = 'uploaded to TestFlight';
        yield* log.step('submit', submissionDescription, 'testflight');
        if (options.target === 'testing' && bundleId) {
          yield* reportProcessing(resolved.ascKey, bundleId, buildNumber, log);
        }
      }
    }
    if (dryRun) {
      yield* log.gap();
      yield* log.note(
        `Done. ${app.name} ${appVersion} (${buildNumber}) - dry-run, nothing changed`,
      );
      return;
    }
    // Backfill this account's Team ID + app names from Apple the first time we have a live key in hand.
    if (account) yield* refreshIdentityIfStale(account, resolved.ascKey);
    let link: string | undefined;
    if (options.submit && bundleId) {
      link = yield* resolveAscBuildLink(resolved.ascKey, bundleId, options.target);
    }
    yield* renderReceipt({
      app,
      version: appVersion,
      buildNumber,
      report: sizeReport,
      destination: receiptDestination('ios', options),
      link,
      log,
    });
    // Remember this run's picks so the next build defaults to them (app pre-selected, bump auto-applied).
    yield* rememberLastRun(app.name, resolvedBump);
  });
