// Builds the launch-store command tree before any arguments are parsed.

import { Command } from './command.ts';
import { TerminalCommands } from '../terminal/terminal-commands.ts';
import { SetupCommand } from '../launch-file/setup-command.ts';
import { registerStatusCommand } from './commands/release/status.ts';
import { registerRolloutCommand } from './commands/release/rollout.ts';
import { CredentialsCommand } from '../credentials/credentials-command.ts';
import { registerMetadataCommand } from './commands/listing/metadata.ts';
import { registerOffersCommand } from '../apple/offers-command.ts';
import { registerReviewsCommand } from '../apple/reviews-command.ts';
import { registerReportsCommand } from '../apple/reports-command.ts';
import { registerTeamCommand } from '../apple/team-command.ts';
import { registerReleaseConfigCommand } from './commands/release/release-config.ts';
import { registerAppClipsCommand } from '../apple/app-clips-command.ts';
import { registerEuDistributionCommand } from '../apple/eu-distribution-command.ts';
import { registerWalletCommand } from '../apple/wallet.ts';
import { registerGameCenterCommand } from '../apple/game-center-command.ts';
import { registerAccessibilityCommand } from '../apple/accessibility-command.ts';
import { registerAvailabilityCommand } from '../apple/availability-command.ts';
import { registerCustomPagesCommand } from '../apple/custom-product-pages-command.ts';
import { registerExperimentsCommand } from './commands/release/experiments.ts';
import { registerPlayProductsCommand } from '../google/play-products-command.ts';
import { registerPlaySubscriptionsCommand } from '../google/play-subscriptions-command.ts';
import { registerPlayReviewsCommand } from '../google/play-reviews-command.ts';
import { registerPlayTracksCommand } from '../google/play-tracks-command.ts';
import { registerPlayReportsCommand } from '../google/play-reports.ts';
import { registerPlayPricingCommand } from '../google/play-pricing-command.ts';
import { registerDeviceCommand } from './commands/credentials/device.ts';
import { registerTestflightCommand } from './commands/release/testflight.ts';
import { registerEventsCommand } from '../apple/events.ts';
import { registerSandboxCommand } from '../apple/sandbox.ts';

/** Assemble the `launch-store` command tree and return it unparsed. */
export function buildProgram(launchVersion: string = '0.0.0'): Command {
  const program = new Command();
  const terminalCommands = new TerminalCommands();

  program
    .setName('launch-store')
    .description('Call the App Store Connect and Google Play APIs from your machine.')
    .version(launchVersion);

  new SetupCommand().register(program);
  registerStatusCommand(program);
  terminalCommands.registerOpen(program);
  registerRolloutCommand(program);
  new CredentialsCommand().register(program);
  registerMetadataCommand(program);
  registerOffersCommand(program);
  registerReviewsCommand(program);
  registerReportsCommand(program);
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
  registerSandboxCommand(program);
  terminalCommands.registerCompletion(program);

  function showHelp() {
    program.outputHelp();
  }

  program.action(showHelp);

  return program;
}
