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
const homeDirectory = mkdtempSync(join(tmpdir(), 'launch-pushkeys-'));

/** A realistic multi-line PKCS#8 PEM so the base64 round-trip exercises the real decode path. */
const PEM = [
  '-----BEGIN PRIVATE KEY-----',
  'MIGTAgEAMBMGByqGSM49AgEGCCqGSM49',
  '-----END PRIVATE KEY-----',
].join('\n');

beforeEach(() => {
  secrets.clear();
  useLaunchDirectories({ homeDirectory, workingDirectory: homeDirectory });
  useSecretStore(secrets);
  rmSync(resolvePushKeysFilePath(), { force: true });
});

afterAll(() => {
  resetLaunchDirectories();
  resetSecretStore();
  rmSync(homeDirectory, { recursive: true, force: true });
});

describe('push-key vault', () => {
  it('imports a key, vaults the secret namespaced, and round-trips the PEM', async () => {
    await importPushKey({ keyId: 'ABC123DEFG', p8: PEM, teamId: 'TEAM1', label: 'Prod push' });

    expect(secrets.get('apns-p8:ABC123DEFG')).toBeDefined();
    expect(secrets.get('apns-p8:ABC123DEFG')).not.toContain('\n');
    expect(await loadPushKey('ABC123DEFG')).toBe(PEM);
    expect((await listPushKeys())[0]).toMatchObject({
      keyId: 'ABC123DEFG',
      teamId: 'TEAM1',
      label: 'Prod push',
    });
    expect((await listPushKeys())[0]?.importedAt).toEqual(expect.any(String));
  });

  it('re-importing the same Key ID updates in place and keeps the original importedAt', async () => {
    const first = await importPushKey({ keyId: 'ABC123DEFG', p8: PEM, label: 'Old' });
    const second = await importPushKey({ keyId: 'ABC123DEFG', p8: PEM, label: 'New' });

    expect(await listPushKeys()).toHaveLength(1);
    expect((await listPushKeys())[0]?.label).toBe('New');
    expect(second.importedAt).toBe(first.importedAt);
  });

  it('finds a vaulted key case-insensitively and returns null for a missing secret', async () => {
    await importPushKey({ keyId: 'ABC123DEFG', p8: PEM });

    expect((await findPushKey('abc123defg'))?.keyId).toBe('ABC123DEFG');
    expect(await findPushKey('NOPE')).toBeUndefined();
    expect(await loadPushKey('NOPE')).toBeNull();
  });
});
