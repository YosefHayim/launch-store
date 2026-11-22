import type { Command } from '../../../command.ts';
import {
  type CustomProductPagesCommandInput,
  customProductPagesCommandProgram,
} from './custom-product-pages-command.ts';
import { runCliProgram } from '../../../run-cli-program.ts';

type CustomPagesOptions = Readonly<{
  readonly app?: string;
  readonly config: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
}>;

/** Map Commander values without explicit undefined optionals. */
const toCustomProductPagesInput = (
  commandOptions: CustomPagesOptions,
): CustomProductPagesCommandInput => {
  let customPagesInput: CustomProductPagesCommandInput = {
    config: commandOptions.config,
    dryRun: commandOptions.dryRun,
    yes: commandOptions.yes,
  };
  if (commandOptions.app != null) {
    customPagesInput = { ...customPagesInput, app: commandOptions.app };
  }
  return customPagesInput;
};

/** Attach the custom-pages command. */
export const registerCustomPagesCommand = (program: Command): void => {
  program
    .command('custom-pages')
    .description(
      'reconcile custom product pages (alternate listings) from custom-pages.config.json',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--config <path>', 'path to the custom pages config file', 'custom-pages.config.json')
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((commandOptions: CustomPagesOptions) =>
      runCliProgram(customProductPagesCommandProgram(toCustomProductPagesInput(commandOptions))),
    );
};
