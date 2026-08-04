import type { BuildArtifact } from '../types/artifacts.js';
import { Effect } from 'effect';
import { confirmUpload, reportSize, renderReceipt } from './pipelineArtifact.js';
import { resolveSizeBudgetMB } from './pipelineProviders.js';
import type { BuildRunOptions, PreparedBuild } from './pipelineTypes.js';
import { resolveStorageProvider } from '../distribution/storage.js';
import { getHostedBuildProvider } from '../services/registry.js';
/** Build via EAS, store the downloaded `.ipa`, and optionally submit through `eas submit`. */
export const runEasBuild = (prepared: PreparedBuild, options: BuildRunOptions) =>
  Effect.gen(function* () {
    const { config, app, profile, buildContext, log } = prepared;
    let appVersion = app.version;
    if (appVersion === undefined) appVersion = '0.0.0';
    if (options.dryRun) {
      yield* log.step('eas', 'would run `eas build --platform ios --profile <p> --json --wait`');
      if (options.submit) {
        let dryRunDestination = 'App Store review';
        if (options.target === 'testing') dryRunDestination = 'TestFlight';
        yield* log.step(
          'submit',
          `would run \`eas submit --platform ios\` -> ${dryRunDestination}`,
          'testflight',
        );
      }
      yield* log.gap();
      yield* log.note(`Done. ${app.name} ${appVersion} - dry-run (EAS handoff), nothing changed`);
      return;
    }
    const easProvider = yield* getHostedBuildProvider('eas');
    yield* log.step('eas-cli', yield* easProvider.describeCli(), 'eas-handoff');
    yield* log.step('expo session', yield* easProvider.authenticate());
    yield* log.note("Building in Expo's cloud (eas build)...");
    const { artifactPath, sizeReport, buildNumber } = yield* easProvider.build(
      buildContext,
      profile.name,
    );
    yield* log.step('build', artifactPath);
    yield* reportSize(sizeReport, log);
    const artifact: BuildArtifact = {
      path: artifactPath,
      platform: 'ios',
      appName: app.name,
      profile: profile.name,
      version: appVersion,
      buildNumber,
      sizeReport,
      // EAS always clean-builds in Expo's cloud, so its artifacts are reproducible - no release nudge.
      clean: true,
      createdAt: new Date().toISOString(),
    };
    const storageProvider = yield* resolveStorageProvider(config);
    const stored = yield* storageProvider.put(artifact);
    yield* log.step('store', stored.location);
    if (options.submit) {
      let uploadDestination = 'App Store review (via EAS)';
      if (options.target === 'testing') uploadDestination = 'TestFlight (via EAS)';
      yield* confirmUpload({
        report: sizeReport,
        budgetMB: resolveSizeBudgetMB(options, profile),
        destination: uploadDestination,
        app,
        version: appVersion,
        buildNumber,
        yes: options.yes === true,
        log,
      });
      yield* log.note('Submitting via eas submit...');
      yield* easProvider.submit(buildContext, artifactPath, profile.name);
      let submissionDescription = 'submitted for App Store review via EAS';
      if (options.target === 'testing') submissionDescription = 'submitted to TestFlight via EAS';
      yield* log.step('submit', submissionDescription, 'testflight');
    }
    let receiptDestination = 'built - not uploaded';
    if (options.submit) {
      receiptDestination = 'App Store - in review (via EAS)';
      if (options.target === 'testing') receiptDestination = 'TestFlight - via EAS';
    }
    yield* renderReceipt({
      app,
      version: appVersion,
      buildNumber,
      report: sizeReport,
      destination: receiptDestination,
      log,
    });
  });
