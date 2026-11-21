import type { Command } from 'commander';
import {
  Keychain,
  LEGACY_APPLE_PRIVATE_KEY_ACCOUNT,
  applePrivateKeyAccount,
  findActiveAccount,
  readSavedAccounts,
} from '@/credentials/keychain.js';

export class CredentialsCommand {
  constructor(private readonly keychain = new Keychain()) {}

  register(program: Command): void {
    program
      .command('creds [action]')
      .description('show whether the App Store Connect key is in the keychain')
      .action(this.run);
  }

  run = async (action: string | undefined): Promise<void> => {
    const isMissingAction = action == null;

    if (isMissingAction) {
      await this.showStatus();
      return;
    }

    const isStatus = action == 'status';

    if (isStatus) {
      await this.showStatus();
      return;
    }

    throw new Error('This ship path prints key status. Importing a key stays on the later flow.');
  };

  private showStatus = async (): Promise<void> => {
    const saved = await readSavedAccounts();
    const isMissing = saved == null;

    if (isMissing) {
      console.log('No App Store Connect account is saved.');
      return;
    }

    const account = findActiveAccount(saved);
    const namedKey = await this.keychain.read(applePrivateKeyAccount(account.keyId));
    const hasNamedKey = namedKey != null;

    if (hasNamedKey) {
      console.log(`App Store Connect key ${account.keyId} is in the keychain.`);
      return;
    }

    const legacyKey = await this.keychain.read(LEGACY_APPLE_PRIVATE_KEY_ACCOUNT);
    const hasLegacyKey = legacyKey != null;

    if (hasLegacyKey) {
      console.log(`App Store Connect key ${account.keyId} is in the keychain.`);
      return;
    }

    console.log(`App Store Connect key ${account.keyId} is not in the keychain.`);
  };
}
