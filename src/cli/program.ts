import { Command } from './command.ts';
import { SetupCommand } from '../launch-file/setup-command.ts';
import { StoreCommand } from '../store/store-command.ts';
import { registerMigrateCommand } from './commands/setup/migrate.ts';
import { registerConfigCommand } from './commands/setup/config.ts';
import { BuildCommand } from '../build/build-command.ts';
import { ReleaseCommand } from '../release-command.ts';
import { registerStatusCommand } from './commands/release/status.ts';
import { registerOpenCommand } from './commands/terminal/open.ts';
import { registerReleaseTrainCommand } from './commands/release/release-train.ts';
import { registerRolloutCommand } from './commands/release/rollout.ts';
import { CredentialsCommand } from '../credentials/credentials-command.ts';
import { registerSecretCommand } from './commands/credentials/secret.ts';
import { registerMetadataCommand } from './commands/listing/metadata.ts';

import { registerOffersCommand } from './commands/store/apple/offers.ts';
import { registerAiListingCommand } from './commands/listing/ai-listing.ts';
import { registerReviewsCommand } from './commands/store/apple/reviews.ts';
import { registerReportsCommand } from './commands/store/apple/reports.ts';
import { registerInsightsCommand } from './commands/insights/insights.ts';
import { registerTeamCommand } from './commands/store/apple/team.ts';
import { registerReleaseConfigCommand } from './commands/release/release-config.ts';
import { registerAppClipsCommand } from './commands/store/apple/app-clips.ts';
import { registerEuDistributionCommand } from './commands/store/apple/eu-distribution.ts';
import { registerWalletCommand } from './commands/store/apple/wallet.ts';
import { registerGameCenterCommand } from './commands/store/apple/game-center.ts';
import { registerAccessibilityCommand } from './commands/store/apple/accessibility.ts';
import { registerAvailabilityCommand } from './commands/store/apple/availability.ts';
import { registerCustomPagesCommand } from './commands/store/apple/custom-pages.ts';
import { registerExperimentsCommand } from './commands/release/experiments.ts';
import { registerPlayProductsCommand } from './commands/store/google/play-products.ts';
import { registerPlaySubscriptionsCommand } from './commands/store/google/play-subscriptions.ts';
import { registerPlayReviewsCommand } from './commands/store/google/play-reviews.ts';
import { registerPlayTracksCommand } from './commands/store/google/play-tracks.ts';
import { registerPlayReportsCommand } from './commands/store/google/play-reports.ts';
import { registerPlayPricingCommand } from './commands/store/google/play-pricing.ts';
import { registerDeviceCommand } from './commands/credentials/device.ts';
import { registerTestflightCommand } from './commands/release/testflight.ts';
import { registerEventsCommand } from './commands/store/apple/events.ts';
import { registerDoctorCommand } from './commands/setup/doctor.ts';
import { registerStoreCommand } from './commands/readiness/store-doctor.ts';
import { registerAuditCommand } from './commands/readiness/audit.ts';
import { registerPrivacyCommand } from './commands/readiness/privacy.ts';
import { registerIapCommand } from './commands/readiness/iap-doctor.ts';
import { registerSnapshotCommand } from './commands/store/snapshot.ts';
import { registerExplainCommand } from './commands/terminal/explain.ts';
import { registerCompletionCommand } from './commands/terminal/completion.ts';
import { registerUpdateCommand } from './commands/release/update.ts';
import { registerUpdatesCommand } from './commands/release/updates.ts';
import { registerCloudCommand } from './commands/build/cloud.ts';
import { registerBuildsCommand } from './commands/build/builds.ts';
import { registerCiCommand } from './commands/setup/ci.ts';
import { registerRunCommand } from './commands/build/run.ts';
import { registerFingerprintCommand } from './commands/build/fingerprint.ts';
import { registerDiagnoseCommand } from './commands/build/diagnose.ts';
import { registerResignCommand } from './commands/build/resign.ts';
import { registerSetupCommand } from './commands/setup/setup.ts';
import { registerSandboxCommand } from './commands/store/apple/sandbox.ts';
import { registerAppsCommand } from './commands/insights/apps.ts';
import { registerStatsCommand } from './commands/insights/stats.ts';
/**
 * Assemble the full `launch-store` command tree and return it unparsed. Pure - registering providers and
 * dispatching `argv` are the caller's job - so importing this module does nothing observable, which is
 * what lets both the runtime entry and the docs generator share one definition of the command surface.
 */
export const buildProgram = (launchVersion = '0.0.0'): Command => {
  const program = new Command();
  program
    .name('launch-store')
    .description(
      'Build and ship your iOS/Android apps to the stores from your own machine - no Expo bill.',
    )
    .version(launchVersion);
  new SetupCommand().register(program);
  new StoreCommand().register(program);
  registerMigrateCommand(program);
  registerConfigCommand(program);
  new BuildCommand().register(program);
  new ReleaseCommand().register(program);
  registerStatusCommand(program);
  registerOpenCommand(program);
  registerReleaseTrainCommand(program);
  registerRolloutCommand(program);
  new CredentialsCommand().register(program);
  registerSecretCommand(program);
  registerMetadataCommand(program);

  registerOffersCommand(program);
  registerAiListingCommand(program);
  registerReviewsCommand(program);
  registerReportsCommand(program);
  registerInsightsCommand(program);
  registerTeamCommand(program);
  registerReleaseConfigCommand(program);
  registerAppClipsCommand(program);
  registerEuDistributionCommand(program);
  registerWalletCommand(program);
  registerGameCenterCommand(program);
  registerAccessibilityCommand(program);
  registerAvailabilityCommand(program);
  registerCustomPagesCommand(program);
  registerExperimentsCommand(program);
  registerPlayProductsCommand(program);
  registerPlaySubscriptionsCommand(program);
  registerPlayReviewsCommand(program);
  registerPlayTracksCommand(program);
  registerPlayReportsCommand(program);
  registerPlayPricingCommand(program);
  registerDeviceCommand(program);
  registerTestflightCommand(program);
  registerEventsCommand(program);
  registerSetupCommand(program);
  registerSandboxCommand(program);
  registerAppsCommand(program);
  registerStatsCommand(program);
  registerDoctorCommand(program);
  registerStoreCommand(program);
  registerAuditCommand(program);
  registerPrivacyCommand(program);
  registerIapCommand(program);
  registerSnapshotCommand(program);
  registerExplainCommand(program);
  registerCompletionCommand(program);
  registerUpdateCommand(program);
  registerUpdatesCommand(program);
  registerCloudCommand(program);
  registerBuildsCommand(program);
  registerCiCommand(program);
  registerRunCommand(program);
  registerFingerprintCommand(program);
  registerDiagnoseCommand(program);
  registerResignCommand(program);
  program.action(() => {
    program.outputHelp();
  });
  return program;
};
