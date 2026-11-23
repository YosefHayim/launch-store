import type { Command } from '@/cli/command.js';
import {
  type CustomProductPagesCommandInput,
  customProductPagesCommandProgram,
} from './custom-product-pages-command.ts';
import { runCliProgram } from '@/cli/run-cli-program.js';

type CustomPagesOptions = Readonly<{
  readonly app?: string;
  readonly config: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
}>;

/** Map Commander values without explicit undefined optionals. */
function readCustomProductPages(
  commandOptions: CustomPagesOptions,
): CustomProductPagesCommandInput {
  let customPagesInput: CustomProductPagesCommandInput = {
    config: commandOptions.config,
    dryRun: commandOptions.dryRun,
    yes: commandOptions.yes,
  };

  if (commandOptions.app != null) {
    customPagesInput = { ...customPagesInput, app: commandOptions.app };
  }

  return customPagesInput;
}

/** Attach the custom-pages command. */
export function registerCustomPagesCommand(program: Command): void {
  function runCustomPages(commandOptions: CustomPagesOptions) {
    const customProductPages = readCustomProductPages(commandOptions);
    const customProductPagesProgram = customProductPagesCommandProgram(customProductPages);
    return runCliProgram(customProductPagesProgram);
  }

  program
    .command('custom-pages')
    .description(
      'reconcile custom product pages (alternate listings) from custom-pages.config.json',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--config <path>', 'path to the custom pages config file', 'custom-pages.config.json')
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runCustomPages);
}
