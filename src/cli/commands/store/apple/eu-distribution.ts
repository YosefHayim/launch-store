import type { Command } from '../../../command.ts';
import { euDistributionCommandProgram } from './eu-distribution-command.ts';
import { runCliProgram } from '../../../run-cli-program.ts';

type EuDistributionOptions = Readonly<{
  config: string;
  dryRun: boolean;
  yes: boolean;
}>;

export function registerEuDistributionCommand(program: Command): void {
  function runEuDistribution(commandOptions: EuDistributionOptions, command: Command) {
    const euDistributionProgram = euDistributionCommandProgram({
      operation: 'reconcile',
      configPath: commandOptions.config,
      explicitConfig: command.getOptionValueSource('config') == 'cli',
      dryRun: commandOptions.dryRun,
      yes: commandOptions.yes,
    });

    return runCliProgram(euDistributionProgram);
  }

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
    .action(runEuDistribution);

  function runSetKeyPemPath(pemPath: string) {
    const euDistributionProgram = euDistributionCommandProgram({ operation: 'set-key', pemPath });
    return runCliProgram(euDistributionProgram);
  }

  euDistributionCommand
    .command('set-key <pemPath>')
    .description(
      "register the team's package-signing public key (the public half - a plain .pem file)",
    )
    .action(runSetKeyPemPath);

  function runList() {
    const euDistributionProgram = euDistributionCommandProgram({ operation: 'list' });
    return runCliProgram(euDistributionProgram);
  }

  euDistributionCommand
    .command('list')
    .description("show the team's authorized distribution domains and whether a key is registered")
    .action(runList);
}
