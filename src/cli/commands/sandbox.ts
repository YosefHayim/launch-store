/**
 * `launch sandbox list|clear` — list the account's StoreKit **sandbox testers** and clear their purchase
 * history from the CLI, using the App Store Connect API key alone (the local equivalent of the sandbox
 * "Clear Purchase History" button). Testers are account-wide, so nothing here is app-scoped.
 *
 * Thin glue over `core/sandbox.ts`: this file resolves the account, renders output, and guards the one
 * state-resetting write (clearing purchase history) behind a confirmation. All logic lives in the core
 * module and the ASC client.
 */

import { cancel, confirm, isCancel } from '@clack/prompts';
import type { Command } from 'commander';
import type { SandboxTesterResource } from '../../apple/ascClient.js';
import { AppStoreConnectClient } from '../../apple/ascClient.js';
import { loadActiveAscKey } from '../../core/accounts.js';
import { createLogger } from '../../core/logger.js';
import { clearPurchaseHistory, listSandboxTesters } from '../../core/sandbox.js';

const log = createLogger(false);

/** Build a client bound to the active Apple account, or fail with the onboarding hint. */
async function activeClient(): Promise<AppStoreConnectClient> {
  const ascKey = await loadActiveAscKey();
  if (!ascKey) throw new Error('No active Apple account. Run `launch creds set-key` first.');
  return new AppStoreConnectClient(ascKey);
}

/** Render one sandbox tester: email, name, territory, and accelerated renewal rate. */
function renderTester(tester: SandboxTesterResource): string {
  const name = [tester.firstName, tester.lastName].filter(Boolean).join(' ');
  const renewal = tester.subscriptionRenewalRate
    ? `renews ${tester.subscriptionRenewalRate}`
    : undefined;
  return [tester.acAccountName, name, tester.territory, renewal].filter(Boolean).join('  ');
}

/** Confirm a state-resetting write, refusing in CI unless `--yes` was passed. */
async function confirmWrite(message: string, yes: boolean | undefined): Promise<boolean> {
  if (yes) return true;
  if (!process.stdout.isTTY) {
    throw new Error(
      'Refusing to clear purchase history without confirmation. Re-run with --yes (non-interactive).',
    );
  }
  const proceed = await confirm({ message });
  if (isCancel(proceed) || !proceed) {
    cancel('Aborted — nothing cleared.');
    return false;
  }
  return true;
}

/** Attach the `sandbox` command (with `list` / `clear` subcommands) to the program. */
export function registerSandboxCommand(program: Command): void {
  const sandbox = program
    .command('sandbox')
    .description('list StoreKit sandbox testers and clear their purchase history');

  sandbox
    .command('list')
    .description("list the account's sandbox testers")
    .option('--json', 'output machine-readable JSON', false)
    .action(async (options: { json?: boolean }) => {
      const client = await activeClient();
      const testers = await listSandboxTesters(client);

      if (options.json) {
        log.line(JSON.stringify(testers, null, 2));
        return;
      }
      if (testers.length === 0) {
        log.line(
          'No sandbox testers. Create them in App Store Connect → Users and Access → Sandbox Testers.',
        );
        return;
      }
      log.line(testers.map(renderTester).join('\n'));
      log.line(`\n${testers.length} sandbox tester${testers.length === 1 ? '' : 's'}.`);
    });

  sandbox
    .command('clear')
    .description("clear sandbox testers' StoreKit purchase history (for re-testing purchases)")
    .argument('[emails...]', 'sandbox tester emails to clear (omit when using --all)')
    .option('--all', "clear every sandbox tester's purchase history", false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(async (emails: string[], options: { all?: boolean; yes?: boolean }) => {
      const log = createLogger(false);
      const all = options.all === true;
      const target = all ? 'every sandbox tester' : `${emails.length} sandbox tester(s)`;
      if (!(await confirmWrite(`Clear purchase history for ${target}?`, options.yes))) return;

      const client = await activeClient();
      const { cleared, notFound } = await clearPurchaseHistory(client, { emails, all });

      if (cleared.length > 0) {
        log.step(
          'purchase history cleared',
          cleared.map((tester) => tester.acAccountName).join(', '),
        );
      } else {
        log.info('No matching sandbox testers — nothing cleared.');
      }
      if (notFound.length > 0) {
        log.warn(`No sandbox tester found for: ${notFound.join(', ')}`);
      }
    });
}
