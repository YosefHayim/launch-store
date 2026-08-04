import type { Command } from 'commander';
import { euDistributionCommandProgram } from '@core/store/euDistributionCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type EuDistributionOptions = Readonly<{
  config: string;
  dryRun: boolean;
  yes: boolean;
}>;

export const registerEuDistributionCommand = (program: Command): void => {
  const euDistributionCommand = program
    .command('eu-distribution')
    .description(
      'authorize EU alternative-distribution domains from eu-distribution.config.json (DMA)',
    )
    .option(
      '--config <path>',
      'path to the EU distribution config file',
      'eu-distribution.config.json',
    )
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((commandOptions: EuDistributionOptions, command: Command) =>
      runCliProgram(
        euDistributionCommandProgram({
          operation: 'reconcile',
          configPath: commandOptions.config,
          explicitConfig: command.getOptionValueSource('config') === 'cli',
          dryRun: commandOptions.dryRun,
          yes: commandOptions.yes,
        }),
      ),
    );

  euDistributionCommand
    .command('set-key <pemPath>')
    .description(
      "register the team's package-signing public key (the public half - a plain .pem file)",
    )
    .action((pemPath: string) =>
      runCliProgram(euDistributionCommandProgram({ operation: 'set-key', pemPath })),
    );

  euDistributionCommand
    .command('list')
    .description("show the team's authorized distribution domains and whether a key is registered")
    .action(() => runCliProgram(euDistributionCommandProgram({ operation: 'list' })));
};
