import type { BuildArtifact } from '../types/artifacts.ts';
import { confirmUpload, reportSize, renderReceipt } from './pipeline-artifact.ts';
import { resolveSizeBudgetMB } from './pipeline-providers.ts';
import type { BuildRunOptions, PreparedBuild } from './pipeline-types.ts';
import { resolveStorageProvider } from '../distribution/storage.ts';
import { getHostedBuildProvider } from '../services/provider-support/registry.ts';

function readAppVersion(version: string | undefined): string {
  const versionIsMissing = version == null;

  if (versionIsMissing) {
    return '0.0.0';
  }

  return version;
}

/** Build via EAS, store the downloaded `.ipa`, and optionally submit through `eas submit`. */
export async function runEasBuild(
  prepared: PreparedBuild,
  buildOptions: BuildRunOptions,
): Promise<void> {
  const { config: launchConfig, app, profile, buildContext, log } = prepared;
  const appVersion = readAppVersion(app.version);

  const isDryRun = buildOptions.dryRun == true;

  if (isDryRun) {
    log.step('eas', 'would run `eas build --platform ios --profile <p> --json --wait`');
    const shouldSubmit = buildOptions.submit == true;

    if (shouldSubmit) {
      log.step('submit', 'would run `eas submit --platform ios` -> TestFlight', 'testflight');
    }

    log.gap();
    log.note(`Done. ${app.name} ${appVersion} - dry-run (EAS handoff), nothing changed`);
    return;
  }

  const easProvider = getHostedBuildProvider('eas');
  const cliDescription = await easProvider.describeCli();
  log.step('eas-cli', cliDescription, 'eas-handoff');
  const sessionDescription = await easProvider.authenticate();
  log.step('expo session', sessionDescription);
  log.note("Building in Expo's cloud (eas build)...");
  const built = await easProvider.build(buildContext, profile.name);
  log.step('build', built.artifactPath);
  await reportSize(built.sizeReport, log);
  const artifact: BuildArtifact = {
    path: built.artifactPath,
    platform: 'ios',
    appName: app.name,
    profile: profile.name,
    version: appVersion,
    buildNumber: built.buildNumber,
    sizeReport: built.sizeReport,
    // EAS always clean-builds in Expo's cloud, so its artifacts are reproducible.
    clean: true,
    createdAt: new Date().toISOString(),
  };
  const storageProvider = await resolveStorageProvider(launchConfig);
  const stored = await storageProvider.put(artifact);
  log.step('store', stored.location);
  const shouldSubmit = buildOptions.submit == true;

  if (shouldSubmit) {
    await confirmUpload({
      report: built.sizeReport,
      budgetMB: resolveSizeBudgetMB(buildOptions, profile),
      destination: 'TestFlight (via EAS)',
      app,
      version: appVersion,
      buildNumber: built.buildNumber,
      yes: buildOptions.yes == true,
      log,
    });
    log.note('Submitting via eas submit...');
    await easProvider.submit(buildContext, built.artifactPath, profile.name);
    log.step('submit', 'uploaded to TestFlight via EAS', 'testflight');
  }

  let receiptDestination = 'built - not uploaded';

  if (shouldSubmit) {
    receiptDestination = 'TestFlight - via EAS';
  }

  await renderReceipt({
    app,
    version: appVersion,
    buildNumber: built.buildNumber,
    report: built.sizeReport,
    destination: receiptDestination,
    log,
  });
}
