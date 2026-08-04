import type { Command } from 'commander';
import { walletCommandProgram } from '@core/store/walletCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type WalletOptions = Readonly<{
  config: string;
  dryRun: boolean;
  yes: boolean;
}>;

export const registerWalletCommand = (program: Command): void => {
  const walletCommand = program
    .command('wallet')
    .description('register Apple Pay merchant ids & Wallet pass type ids from wallet.config.json')
    .option('--config <path>', 'path to the wallet config file', 'wallet.config.json')
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((commandOptions: WalletOptions, command: Command) =>
      runCliProgram(
        walletCommandProgram({
          operation: 'reconcile',
          configPath: commandOptions.config,
          explicitConfig: command.getOptionValueSource('config') === 'cli',
          dryRun: commandOptions.dryRun,
          yes: commandOptions.yes,
        }),
      ),
    );

  walletCommand
    .command('list')
    .description("show the team's registered Apple Pay merchant ids and Wallet pass type ids")
    .action(() => runCliProgram(walletCommandProgram({ operation: 'list' })));
};
