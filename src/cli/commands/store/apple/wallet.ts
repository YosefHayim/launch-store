import type { Command } from '../../../command.ts';
import { walletCommandProgram } from './wallet-command.ts';
import { runCliProgram } from '../../../run-cli-program.ts';

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
    .action((commandOptions: WalletOptions, command: Command) => {
      const walletProgram = walletCommandProgram({
        operation: 'reconcile',
        configPath: commandOptions.config,
        explicitConfig: command.getOptionValueSource('config') == 'cli',
        dryRun: commandOptions.dryRun,
        yes: commandOptions.yes,
      });
      return runCliProgram(walletProgram);
    });

  walletCommand
    .command('list')
    .description("show the team's registered Apple Pay merchant ids and Wallet pass type ids")
    .action(() => {
      const walletProgram = walletCommandProgram({ operation: 'list' });
      return runCliProgram(walletProgram);
    });
};
