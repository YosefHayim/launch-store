/**
 * Tests for the APNs push-key vault. Runs against an in-memory secret store and a real temp `~/.launch`
 * (HOME redirected to a throwaway dir so the real paths module resolves there), with `apple/credentials`
 * stubbed so importing `accounts.js` — which `pushKeyStore` borrows `encodeP8`/`decodeP8` from — pulls
 * in no signing/exec code. Covers the round-trip of a stored `.p8` and in-place re-import.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';

const secrets = vi.hoisted(() => ({ store: new Map<string, string>() }));
const home = vi.hoisted(() => {
  const dir = `${process.env['TMPDIR'] ?? '/tmp'}/launch-pushkeys-test-${process.pid}`;
  process.env['HOME'] = dir;
  process.env['USERPROFILE'] = dir;
  return { dir };
});

vi.mock('./keychain.js', () => ({
  setSecret: async (account: string, value: string) => void secrets.store.set(account, value),
  getSecret: async (account: string) => secrets.store.get(account) ?? null,
  deleteSecret: async (account: string) => void secrets.store.delete(account),
}));

vi.mock('../apple/credentials.js', () => ({
  migrateLegacySigningIndex: vi.fn(),
  p12PasswordAccount: (keyId: string) => `dist-cert-p12-password:${keyId}`,
}));

import { PUSH_KEYS_FILE } from './paths.js';
import { findPushKey, importPushKey, listPushKeys, loadPushKey } from './pushKeyStore.js';

/** A realistic multi-line PKCS#8 PEM so the base64 round-trip exercises the real decode path. */
const PEM = [
  '-----BEGIN PRIVATE KEY-----',
  'MIGTAgEAMBMGByqGSM49AgEGCCqGSM49',
  '-----END PRIVATE KEY-----',
].join('\n');

beforeEach(() => {
  secrets.store.clear();
  rmSync(PUSH_KEYS_FILE, { force: true });
});

afterAll(() => {
  rmSync(home.dir, { recursive: true, force: true });
});

describe('push-key vault', () => {
  it('imports a key, vaults the secret namespaced, and round-trips the PEM', async () => {
    await importPushKey({ keyId: 'ABC123DEFG', p8: PEM, teamId: 'TEAM1', label: 'Prod push' });
    expect(secrets.store.get('apns-p8:ABC123DEFG')).toBeDefined();
    expect(secrets.store.get('apns-p8:ABC123DEFG')).not.toContain('\n');
    expect(await loadPushKey('ABC123DEFG')).toBe(PEM);
    expect(listPushKeys()[0]).toMatchObject({
      keyId: 'ABC123DEFG',
      teamId: 'TEAM1',
      label: 'Prod push',
    });
    expect(listPushKeys()[0]?.importedAt).toEqual(expect.any(String));
  });

  it('re-importing the same Key ID updates in place and keeps the original importedAt', async () => {
    const first = await importPushKey({ keyId: 'ABC123DEFG', p8: PEM, label: 'Old' });
    const second = await importPushKey({ keyId: 'ABC123DEFG', p8: PEM, label: 'New' });
    expect(listPushKeys()).toHaveLength(1);
    expect(listPushKeys()[0]?.label).toBe('New');
    expect(second.importedAt).toBe(first.importedAt);
  });

  it('finds a vaulted key case-insensitively and returns null for a missing secret', async () => {
    await importPushKey({ keyId: 'ABC123DEFG', p8: PEM });
    expect(findPushKey('abc123defg')?.keyId).toBe('ABC123DEFG');
    expect(findPushKey('NOPE')).toBeUndefined();
    expect(await loadPushKey('NOPE')).toBeNull();
  });
});
