// Saves the Apple key and the Play service account in the OS keychain.

import { spawnSync } from 'node:child_process';

import type { AppleKey } from '@/apple/app-store-connect.js';

const KEYCHAIN_SERVICE = 'launch';
const macosItemNotFoundExitCode = 44;

export class Keychain {
  async readApple(): Promise<AppleKey> {
    const secretText = await this.readSecret('apple');
    const isMissing = secretText == null;

    if (isMissing) {
      throw new Error('No Apple key. Run launch credentials.');
    }

    return readAppleKey(secretText);
  }

  async saveApple(key: AppleKey): Promise<void> {
    await this.saveSecret('apple', JSON.stringify(key));
  }

  async readGoogle(packageName: string): Promise<string> {
    const secretText = await this.readSecret(`google:${packageName}`);
    const isMissing = secretText == null;

    if (isMissing) {
      throw new Error('No Google Play account. Run launch credentials.');
    }

    return secretText;
  }

  async saveGoogle(packageName: string, serviceAccountJson: string): Promise<void> {
    await this.saveSecret(`google:${packageName}`, serviceAccountJson);
  }

  private async readSecret(account: string): Promise<string | null> {
    const { Entry } = await loadKeyring();

    var password: string | null;

    try {
      password = new Entry(KEYCHAIN_SERVICE, account).getPassword();
    } catch (error) {
      const isDenied = isKeychainDenied(account);

      if (isDenied) {
        throw new Error(`Could not read ${account} from the keychain.`, { cause: error });
      }

      return null;
    }

    const isMissing = password == null;

    if (isMissing) {
      const isDenied = isKeychainDenied(account);

      if (isDenied) {
        throw new Error(`Could not read ${account} from the keychain.`);
      }

      return null;
    }

    return password;
  }

  private async saveSecret(account: string, secretText: string): Promise<void> {
    const { Entry } = await loadKeyring();

    try {
      new Entry(KEYCHAIN_SERVICE, account).setPassword(secretText);
    } catch (error) {
      throw new Error(`Could not save ${account} in the keychain.`, { cause: error });
    }
  }
}

export function readAppleKey(secretText: string): AppleKey {
  var parsed: unknown;

  try {
    parsed = JSON.parse(secretText) as unknown;
  } catch (error) {
    throw new Error('The Apple key in the keychain is not valid JSON.', { cause: error });
  }

  const isMissing = parsed == null;

  if (isMissing) {
    throw new Error('The Apple key in the keychain is not valid JSON.');
  }

  const isNotObject = typeof parsed !== 'object';

  if (isNotObject) {
    throw new Error('The Apple key in the keychain is not valid JSON.');
  }

  const record = parsed as Record<string, unknown>;

  return {
    keyId: readKeyField(record, 'keyId'),
    issuerId: readKeyField(record, 'issuerId'),
    privateKey: readKeyField(record, 'privateKey'),
  };
}

function readKeyField(record: Record<string, unknown>, fieldName: string): string {
  const field = record[fieldName];
  const isText = typeof field === 'string';

  if (!isText) {
    throw new Error(`The Apple key in the keychain needs ${fieldName}.`);
  }

  const isEmpty = field.length === 0;

  if (isEmpty) {
    throw new Error(`The Apple key in the keychain needs ${fieldName}.`);
  }

  return field;
}

async function loadKeyring(): Promise<typeof import('@napi-rs/keyring')> {
  var keyring: typeof import('@napi-rs/keyring');

  try {
    keyring = await import('@napi-rs/keyring');
  } catch (error) {
    throw new Error('Install the keychain module: pnpm add @napi-rs/keyring', { cause: error });
  }

  return keyring;
}

function isKeychainDenied(account: string): boolean {
  const isMac = process.platform === 'darwin';

  if (!isMac) {
    return false;
  }

  const security = spawnSync(
    'security',
    ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account],
    { encoding: 'utf8' },
  );
  const isMissing = security.status === macosItemNotFoundExitCode;

  if (isMissing) {
    return false;
  }

  return true;
}
