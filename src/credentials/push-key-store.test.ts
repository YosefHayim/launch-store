import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetSecretStore, useSecretStore } from '../services/credentials/secret-store.ts';
import {
  resetLaunchDirectories,
  resolvePushKeysFilePath,
  useLaunchDirectories,
} from '../services/platform/paths.ts';
import { findPushKey, importPushKey, listPushKeys, loadPushKey } from './push-key-store.ts';

const secrets = new Map<string, string>();
const systemTemporaryDirectory = tmpdir();
const launchPushkeysPath = join(systemTemporaryDirectory, 'launch-pushkeys-');
const homeDirectory = mkdtempSync(launchPushkeysPath);

/** A realistic multi-line PKCS#8 PEM so the base64 round-trip exercises the real decode path. */
const PEM = [
  '-----BEGIN PRIVATE KEY-----',
  'MIGTAgEAMBMGByqGSM49AgEGCCqGSM49',
  '-----END PRIVATE KEY-----',
].join('\n');
function prepare() {
  secrets.clear();
  useLaunchDirectories({ homeDirectory, workingDirectory: homeDirectory });
  useSecretStore(secrets);
  const pushKeysFilePath = resolvePushKeysFilePath();
  rmSync(pushKeysFilePath, { force: true });
}

beforeEach(prepare);
function cleanupAll() {
  resetLaunchDirectories();
  resetSecretStore();
  rmSync(homeDirectory, { recursive: true, force: true });
}

afterAll(cleanupAll);
function describePushKeyVault() {
  async function importsAKeyVaultsTheSecretNamespacedAndRoundTripsThePEM() {
    await importPushKey({ keyId: 'ABC123DEFG', p8: PEM, teamId: 'TEAM1', label: 'Prod push' });

    expect(secrets.get('apns-p8:ABC123DEFG')).toBeDefined();
    expect(secrets.get('apns-p8:ABC123DEFG')).not.toContain('\n');
    const pushKey = await loadPushKey('ABC123DEFG');
    expect(pushKey).toBe(PEM);
    const pushKeys = await listPushKeys();
    expect(pushKeys[0]).toMatchObject({
      keyId: 'ABC123DEFG',
      teamId: 'TEAM1',
      label: 'Prod push',
    });
    expect((await listPushKeys())[0]?.importedAt).toEqual(expect.any(String));
  }

  it(
    'imports a key, vaults the secret namespaced, and round-trips the PEM',
    importsAKeyVaultsTheSecretNamespacedAndRoundTripsThePEM,
  );
  async function reImportingTheSameKeyIDUpdatesInPlaceAndKeepsTheOriginalImportedAt() {
    const first = await importPushKey({ keyId: 'ABC123DEFG', p8: PEM, label: 'Old' });
    const second = await importPushKey({ keyId: 'ABC123DEFG', p8: PEM, label: 'New' });

    const pushKeys = await listPushKeys();
    expect(pushKeys).toHaveLength(1);
    expect((await listPushKeys())[0]?.label).toBe('New');
    expect(second.importedAt).toBe(first.importedAt);
  }

  it(
    're-importing the same Key ID updates in place and keeps the original importedAt',
    reImportingTheSameKeyIDUpdatesInPlaceAndKeepsTheOriginalImportedAt,
  );
  async function findsAVaultedKeyCaseInsensitivelyAndReturnsNullForAMissingSecret() {
    await importPushKey({ keyId: 'ABC123DEFG', p8: PEM });

    const pushKey = await findPushKey('abc123defg');
    expect(pushKey?.keyId).toBe('ABC123DEFG');
    expect(await findPushKey('NOPE')).toBeUndefined();
    expect(await loadPushKey('NOPE')).toBeNull();
  }

  it(
    'finds a vaulted key case-insensitively and returns null for a missing secret',
    findsAVaultedKeyCaseInsensitivelyAndReturnsNullForAMissingSecret,
  );
}

describe('push-key vault', describePushKeyVault);
