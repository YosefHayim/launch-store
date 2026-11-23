// Registers the command that shows a recommended Google Play price in every region.

import type { Command } from '../cli/command.ts';
import { type PlayPricingCommandInput, playPricingCommandProgram } from './play-pricing.ts';
import { runCliProgram } from '../cli/run-cli-program.ts';

type PlayPricingOptions = Readonly<{
  readonly app?: string;
  readonly currency: string;
  readonly json: boolean;
}>;

/** Map pricing flags without explicit undefined optionals. */
function readPlayPricing(
  amount: string,
  commandOptions: PlayPricingOptions,
): PlayPricingCommandInput {
  let commandInput: PlayPricingCommandInput = {
    amount,
    currency: commandOptions.currency,
    json: commandOptions.json,
  };

  if (commandOptions.app != null) {
    commandInput = { ...commandInput, app: commandOptions.app };
  }

  return commandInput;
}

/** Attach the play-pricing command group. */
export function registerPlayPricingCommand(program: Command): void {
  const pricingCommand = program
    .command('play-pricing')
    .description('compute recommended Google Play prices for every region from one base price');

  function runLocalizeAmount(amount: string, commandOptions: PlayPricingOptions) {
    const playPricing = readPlayPricing(amount, commandOptions);
    const playPricingProgram = playPricingCommandProgram(playPricing);
    return runCliProgram(playPricingProgram);
  }

  pricingCommand
    .command('localize <amount>')
    .description("show Google's recommended local price for every Play market, from one base price")
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('-c, --currency <code>', 'ISO-4217 currency of <amount>', 'USD')
    .option('--json', 'output machine-readable JSON', false)
    .action(runLocalizeAmount);
}
