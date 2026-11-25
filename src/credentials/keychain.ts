// Saves the Apple key and the Play service account in the macOS keychain.
// Node has no keychain API. `security -w` is the platform command; the secret
// is base64 for that one call so a newline still round-trips. Other processes
// can see the command line while `security` runs.

import { spawnSync } from 'node:child_process';

import type { AppleKey } from '@/apple/app-store-connect.js';

const KEYCHAIN_SERVICE = 'launch';
const macosItemNotFoundExitCode = 44;

export class Keychain {
  async readApple(): Promise<AppleKey> {
    const secretText = readKeychainItem('apple');
    const isMissing = secretText == null;

    if (isMissing) {
      throw new Error('No Apple key. Run launch credentials.');
    }

    return readAppleKey(secretText);
  }

  async saveApple(key: AppleKey): Promise<void> {
    writeKeychainItem('apple', JSON.stringify(key));
  }

  async readGoogle(packageName: string): Promise<string> {
    const secretText = readKeychainItem(`google:${packageName}`);
    const isMissing = secretText == null;

    if (isMissing) {
      throw new Error('No Google Play account. Run launch credentials.');
    }

    return secretText;
  }

  async saveGoogle(packageName: string, serviceAccountJson: string): Promise<void> {
    writeKeychainItem(`google:${packageName}`, serviceAccountJson);
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

function readKeychainItem(account: string): string | null {
  const security = runSecurity([
    'find-generic-password',
    '-s',
    KEYCHAIN_SERVICE,
    '-a',
    account,
    '-w',
  ]);
  const isMissing = security.status === macosItemNotFoundExitCode;

  if (isMissing) {
    return null;
  }

  const isFailed = security.status !== 0;

  if (isFailed) {
    throw new Error(`Could not read ${account} from the keychain.`, { cause: security.cause });
  }

  return readStoredSecret(security.stdout);
}

function writeKeychainItem(account: string, secretText: string): void {
  const stored = Buffer.from(secretText, 'utf8').toString('base64');
  const security = runSecurity([
    'add-generic-password',
    '-s',
    KEYCHAIN_SERVICE,
    '-a',
    account,
    '-w',
    stored,
    '-U',
  ]);
  const isFailed = security.status !== 0;

  if (isFailed) {
    throw new Error(`Could not save ${account} in the keychain.`, { cause: security.cause });
  }
}

function runSecurity(args: string[]): { status: number | null; stdout: string; cause: unknown } {
  const isNotMac = process.platform !== 'darwin';

  if (isNotMac) {
    throw new Error('The keychain needs macOS.');
  }

  const security = spawnSync('security', args, { encoding: 'utf8' });
  const spawnError = security.error;

  if (spawnError != null) {
    return { status: security.status, stdout: '', cause: spawnError };
  }

  return { status: security.status, stdout: security.stdout, cause: security.stderr };
}

export function readStoredSecret(printed: string): string {
  const hasTrailingLine = printed.endsWith('\n');

  if (hasTrailingLine) {
    return readSecretText(printed.slice(0, -1));
  }

  return readSecretText(printed);
}

function readSecretText(stored: string): string {
  // Items saved by the old keychain addon are the secret text. New items are base64.
  const isLegacySecret = stored.startsWith('{');

  if (isLegacySecret) {
    return stored;
  }

  return Buffer.from(stored, 'base64').toString('utf8');
}
