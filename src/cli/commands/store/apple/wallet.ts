// Registers the commands that sync Apple Pay merchant ids and Wallet pass type ids.

import type { Command } from '@/cli/command.js';
import { walletCommandProgram } from './wallet-command.ts';
import { runCliProgram } from '@/cli/run-cli-program.js';

type WalletOptions = Readonly<{
  dryRun: boolean;
  yes: boolean;
}>;

export function registerWalletCommand(program: Command): void {
  function runWallet(commandOptions: WalletOptions) {
    const walletProgram = walletCommandProgram({
      operation: 'reconcile',
      dryRun: commandOptions.dryRun,
      yes: commandOptions.yes,
    });

    return runCliProgram(walletProgram);
  }

  const walletCommand = program
    .command('wallet')
    .description('register Apple Pay merchant ids and Wallet pass type ids from launch.config.ts')
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runWallet);

  function runList() {
    const walletProgram = walletCommandProgram({ operation: 'list' });
    return runCliProgram(walletProgram);
  }

  walletCommand
    .command('list')
    .description("show the team's registered Apple Pay merchant ids and Wallet pass type ids")
    .action(runList);
}
