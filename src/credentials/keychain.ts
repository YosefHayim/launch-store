import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const KEYCHAIN_SERVICE_NAME = 'launch';
const LEGACY_APPLE_PRIVATE_KEY_ACCOUNT = 'asc-p8';
const LEGACY_PLAY_SERVICE_ACCOUNT = 'play-service-account';

export interface SavedAccount {
  keyId: string;
  issuerId: string;
  teamId: string | null;
  label: string | null;
}

export interface SavedAccounts {
  activeKeyId: string | null;
  accounts: readonly SavedAccount[];
}

interface AccountsDocument {
  active?: string | null;
  accounts?: readonly {
    keyId?: string;
    issuerId?: string;
    teamId?: string;
    label?: string;
  }[];
}

function accountsFilePath(): string {
  return join(homedir(), '.launch', 'accounts.json');
}

export function applePrivateKeyAccount(keyId: string): string {
  return `asc-p8:${keyId}`;
}

export function playServiceAccount(packageName: string): string {
  return `play-service-account:${packageName}`;
}

export { LEGACY_APPLE_PRIVATE_KEY_ACCOUNT, LEGACY_PLAY_SERVICE_ACCOUNT };

export class Keychain {
  constructor(private readonly secrets: Map<string, string> | null = null) {}

  async read(account: string): Promise<string | null> {
    const memorySecrets = this.secrets;
    const usesNativeKeychain = memorySecrets == null;

    if (usesNativeKeychain) {
      return this.readNative(account);
    }

    const secretText = memorySecrets.get(account);
    const isMissing = secretText == null;

    if (isMissing) {
      return null;
    }

    return secretText;
  }

  private async readNative(account: string): Promise<string | null> {
    try {
      var keyring = await import('@napi-rs/keyring');
    } catch (error) {
      throw new Error('Install @napi-rs/keyring to read the keychain', { cause: error });
    }

    try {
      var storedPassword = new keyring.Entry(KEYCHAIN_SERVICE_NAME, account).getPassword();
    } catch (error) {
      throw new Error(`Could not read ${account} from the keychain`, { cause: error });
    }

    const isBlank = storedPassword == null;

    if (isBlank) {
      return this.missingOrDenied(account);
    }

    return storedPassword;
  }

  private missingOrDenied(account: string): string | null {
    const isMac = platform() == 'darwin';

    if (isMac == false) {
      return null;
    }

    const security = spawnSync(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE_NAME, '-a', account],
      { encoding: 'utf8' },
    );
    const isMissing = security.status == 44;

    if (isMissing) {
      return null;
    }

    throw new Error(`Could not read ${account} from the keychain`);
  }
}

export async function readSavedAccounts(): Promise<SavedAccounts | null> {
  try {
    var accountsText = await readFile(accountsFilePath(), 'utf8');
  } catch (error) {
    const isError = error instanceof Error;

    if (isError == false) {
      throw new Error('Could not read ~/.launch/accounts.json', { cause: error });
    }

    const nodeError = error as NodeJS.ErrnoException;
    const isMissing = nodeError.code == 'ENOENT';

    if (isMissing) {
      return null;
    }

    throw new Error('Could not read ~/.launch/accounts.json', { cause: error });
  }

  try {
    var accountsDocument = JSON.parse(accountsText) as AccountsDocument;
  } catch (error) {
    throw new Error('~/.launch/accounts.json is not JSON', { cause: error });
  }

  const rows = accountsDocument.accounts;
  const hasRows = rows != null;

  if (hasRows == false) {
    throw new Error('~/.launch/accounts.json has no accounts');
  }

  const accounts: SavedAccount[] = [];

  for (const row of rows) {
    const keyId = row.keyId;
    const isKeyMissing = keyId == null;

    if (isKeyMissing) {
      continue;
    }

    const issuerId = row.issuerId;
    const isIssuerMissing = issuerId == null;

    if (isIssuerMissing) {
      continue;
    }

    accounts.push({
      keyId,
      issuerId,
      teamId: row.teamId ?? null,
      label: row.label ?? null,
    });
  }

  return { activeKeyId: accountsDocument.active ?? null, accounts };
}

export function findActiveAccount(saved: SavedAccounts): SavedAccount {
  const activeKeyId = saved.activeKeyId;
  const isNoneActive = activeKeyId == null;

  if (isNoneActive) {
    throw new Error('No App Store Connect account is active. Run launch creds.');
  }

  function isActiveAccount(account: SavedAccount): boolean {
    return account.keyId == activeKeyId;
  }

  const account = saved.accounts.find(isActiveAccount);
  const isAccountMissing = account == null;

  if (isAccountMissing) {
    throw new Error('The active App Store Connect account is not in ~/.launch/accounts.json');
  }

  return account;
}
