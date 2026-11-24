// Asks which App Store Connect account to use, and imports a key when none are saved.

import { createLogger } from '../services/platform/logger.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import type { AccountRecord } from '../types/credentials.ts';
import {
  formatAccountSummary,
  getActiveAccount,
  getActiveKeyId,
  listAccounts,
  setActiveKeyId,
} from './accounts.ts';
import type { CredentialsCommandOptions } from './credentials-command-options.ts';
import { importAppleKey, selectAppleKeyFile } from './set-apple-key.ts';

export async function chooseAccountInteractive(
  commandOptions: CredentialsCommandOptions = {},
): Promise<AccountRecord> {
  const accounts = await listAccounts();
  const activeKeyId = await getActiveKeyId();

  if (accounts.length == 0) {
    const p8Path = await selectAppleKeyFile(commandOptions, true);

    await importAppleKey(p8Path, commandOptions, true);

    const importedAccount = await getActiveAccount();

    if (importedAccount == null) {
      throw new Error('No active account after import.');
    }

    return importedAccount;
  }

  const chosenAccount = await new LaunchPrompt().select({
    message: 'Choose an Apple account:',
    choices: accounts.map(function accountChoice(account: AccountRecord) {
      let accountLabel = account.label;

      const isActive = account.keyId == activeKeyId;

      if (isActive) {
        accountLabel = `${accountLabel} (active)`;
      }

      return {
        selection: account,
        label: accountLabel,
        hint: formatAccountSummary(account, { includeLabel: false }),
      };
    }),
  });

  await setActiveKeyId(chosenAccount.keyId);
  createLogger(false).ok(
    `Active Apple account: ${chosenAccount.label} (key ${chosenAccount.keyId}).`,
  );

  return chosenAccount;
}
