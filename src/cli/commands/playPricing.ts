import type { Command } from 'commander';
import {
  type PlayPricingCommandInput,
  playPricingCommandProgram,
} from '@core/store/playPricing.js';
import { runCliProgram } from '../runCliProgram.js';

type PlayPricingOptions = Readonly<{
  readonly app?: string;
  readonly currency: string;
  readonly json: boolean;
}>;

/** Map pricing flags without explicit undefined optionals. */
const toPlayPricingInput = (
  amount: string,
  commandOptions: PlayPricingOptions,
): PlayPricingCommandInput => {
  let commandInput: PlayPricingCommandInput = {
    amount,
    currency: commandOptions.currency,
    json: commandOptions.json,
  };
  if (commandOptions.app !== undefined) {
    commandInput = { ...commandInput, app: commandOptions.app };
  }
  return commandInput;
};

/** Attach the play-pricing command group. */
export const registerPlayPricingCommand = (program: Command): void => {
  const pricingCommand = program
    .command('play-pricing')
    .description('compute recommended Google Play prices for every region from one base price');
  pricingCommand
    .command('localize <amount>')
    .description("show Google's recommended local price for every Play market, from one base price")
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('-c, --currency <code>', 'ISO-4217 currency of <amount>', 'USD')
    .option('--json', 'output machine-readable JSON', false)
    .action((amount: string, commandOptions: PlayPricingOptions) =>
      runCliProgram(playPricingCommandProgram(toPlayPricingInput(amount, commandOptions))),
    );
};
