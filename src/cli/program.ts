// Builds the full launch-store command tree before any arguments are parsed.

import { Command } from './command.ts';
import { SetupCommand } from '../launch-file/setup-command.ts';
import { StoreCommand } from '../store/store-command.ts';
import { registerMigrateCommand } from './commands/setup/migrate.ts';
import { registerConfigCommand } from './commands/setup/config.ts';
import { BuildCommand } from '../build/build-command.ts';
import { registerReleaseCommand } from './commands/release/release.ts';
import { registerStatusCommand } from './commands/release/status.ts';
import { registerOpenCommand } from './commands/terminal/open.ts';
import { registerReleaseTrainCommand } from './commands/release/release-train.ts';
import { registerRolloutCommand } from './commands/release/rollout.ts';
import { CredentialsCommand } from '../credentials/credentials-command.ts';
import { registerSecretCommand } from './commands/credentials/secret.ts';
import { registerMetadataCommand } from './commands/listing/metadata.ts';

import { registerOffersCommand } from '@/apple/commands/offers.js';
import { registerAiListingCommand } from './commands/listing/ai-listing.ts';
import { registerReviewsCommand } from '@/apple/commands/reviews.js';
import { registerReportsCommand } from '@/apple/commands/reports.js';
import { registerInsightsCommand } from './commands/insights/insights.ts';
import { registerTeamCommand } from '@/apple/commands/team.js';
import { registerReleaseConfigCommand } from './commands/release/release-config.ts';
import { registerAppClipsCommand } from '@/apple/commands/app-clips.js';
import { registerEuDistributionCommand } from '@/apple/commands/eu-distribution.js';
import { registerWalletCommand } from '@/apple/commands/wallet.js';
import { registerGameCenterCommand } from '@/apple/commands/game-center.js';
import { registerAccessibilityCommand } from '@/apple/commands/accessibility.js';
import { registerAvailabilityCommand } from '@/apple/commands/availability.js';
import { registerCustomPagesCommand } from '@/apple/commands/custom-pages.js';
import { registerExperimentsCommand } from './commands/release/experiments.ts';
import { registerPlayProductsCommand } from '@/google/commands/play-products.js';
import { registerPlaySubscriptionsCommand } from '@/google/commands/play-subscriptions.js';
import { registerPlayReviewsCommand } from '@/google/commands/play-reviews.js';
import { registerPlayTracksCommand } from '@/google/commands/play-tracks.js';
import { registerPlayReportsCommand } from '@/google/commands/play-reports.js';
import { registerPlayPricingCommand } from '@/google/commands/play-pricing.js';
import { registerDeviceCommand } from './commands/credentials/device.ts';
import { registerTestflightCommand } from './commands/release/testflight.ts';
import { registerEventsCommand } from '@/apple/commands/events.js';
import { registerStoreCommand } from './commands/readiness/store-doctor.ts';
import { registerAuditCommand } from './commands/readiness/audit.ts';
import { registerPrivacyCommand } from './commands/readiness/privacy.ts';
import { registerIapCommand } from './commands/readiness/in-app-purchase-doctor.ts';
import { registerSnapshotCommand } from './commands/store/snapshot.ts';
import { registerExplainCommand } from './commands/terminal/explain.ts';
import { registerCompletionCommand } from './commands/terminal/completion.ts';
import { registerUpdateCommand } from './commands/release/update.ts';
import { registerUpdatesCommand } from './commands/release/updates.ts';
import { registerBuildsCommand } from './commands/build/builds.ts';
import { registerCiCommand } from './commands/setup/continuous-integration.ts';
import { registerRunCommand } from './commands/build/run.ts';
import { registerFingerprintCommand } from './commands/build/fingerprint.ts';
import { registerDiagnoseCommand } from './commands/build/diagnose.ts';
import { registerResignCommand } from './commands/build/resign.ts';
import { registerSetupCommand } from './commands/setup/setup.ts';
import { registerSandboxCommand } from '@/apple/commands/sandbox.js';
import { registerAppsCommand } from './commands/insights/apps.ts';
import { registerStatsCommand } from './commands/insights/stats.ts';

/** Assemble the full `launch-store` command tree and return it unparsed. */
export function buildProgram(launchVersion: string = '0.0.0'): Command {
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
  registerReleaseCommand(program);
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
  registerStoreCommand(program);
  registerAuditCommand(program);
  registerPrivacyCommand(program);
  registerIapCommand(program);
  registerSnapshotCommand(program);
  registerExplainCommand(program);
  registerCompletionCommand(program);
  registerUpdateCommand(program);
  registerUpdatesCommand(program);
  registerBuildsCommand(program);
  registerCiCommand(program);
  registerRunCommand(program);
  registerFingerprintCommand(program);
  registerDiagnoseCommand(program);
  registerResignCommand(program);

  function showHelp() {
    program.outputHelp();
  }

  program.action(showHelp);

  return program;
}
