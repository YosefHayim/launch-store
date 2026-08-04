import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { Effect } from 'effect';
import { NodeContext } from '@effect/platform-node';
import {
  makeLaunchSecretStoreTest,
  type LaunchSecretStoreService,
} from '../services/secretStore.js';
const secrets = vi.hoisted(() => ({ store: new Map<string, string>() }));
const home = vi.hoisted(() => {
  let temporaryDirectory = process.env['TMPDIR'];
  if (temporaryDirectory === undefined) temporaryDirectory = '/tmp';
  const dir = `${temporaryDirectory}/launch-pushkeys-test-${process.pid}`;
  process.env['HOME'] = dir;
  process.env['USERPROFILE'] = dir;
  return { dir };
});
vi.mock('./keychain.js', () => ({
  setSecret: (account: string, secretText: string) =>
    Effect.sync(() => void secrets.store.set(account, secretText)),
  getSecret: (account: string) =>
    Effect.sync(() => {
      const storedSecret = secrets.store.get(account);
      if (storedSecret === undefined) return null;
      return storedSecret;
    }),
  deleteSecret: (account: string) => Effect.sync(() => void secrets.store.delete(account)),
}));
vi.mock('./appleSigning.js', () => ({
  migrateLegacySigningIndex: vi.fn(),
  p12PasswordAccount: (keyId: string) => `dist-cert-p12-password:${keyId}`,
}));
import { PUSH_KEYS_FILE, makeLaunchPathsTest, type LaunchPathsService } from '../services/paths.js';
import { findPushKey, importPushKey, listPushKeys, loadPushKey } from './pushKeyStore.js';
/** Run a push-key program with an isolated secret-store capability. */
const runPushKeyEffect = <TValue, TError>(
  pushKeyEffect: Effect.Effect<
    TValue,
    TError,
    LaunchPathsService | LaunchSecretStoreService | NodeContext.NodeContext
  >,
): Promise<TValue> => {
  return Effect.runPromise(
    pushKeyEffect.pipe(
      Effect.provide(NodeContext.layer),
      Effect.provide(makeLaunchPathsTest(home.dir, home.dir)),
      Effect.provide(makeLaunchSecretStoreTest()),
    ),
  );
};
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
    await runPushKeyEffect(
      importPushKey({ keyId: 'ABC123DEFG', p8: PEM, teamId: 'TEAM1', label: 'Prod push' }),
    );
    expect(secrets.store.get('apns-p8:ABC123DEFG')).toBeDefined();
    expect(secrets.store.get('apns-p8:ABC123DEFG')).not.toContain('\n');
    expect(await runPushKeyEffect(loadPushKey('ABC123DEFG'))).toBe(PEM);
    expect((await runPushKeyEffect(listPushKeys()))[0]).toMatchObject({
      keyId: 'ABC123DEFG',
      teamId: 'TEAM1',
      label: 'Prod push',
    });
    expect((await runPushKeyEffect(listPushKeys()))[0]?.importedAt).toEqual(expect.any(String));
  });
  it('re-importing the same Key ID updates in place and keeps the original importedAt', async () => {
    const first = await runPushKeyEffect(
      importPushKey({ keyId: 'ABC123DEFG', p8: PEM, label: 'Old' }),
    );
    const second = await runPushKeyEffect(
      importPushKey({ keyId: 'ABC123DEFG', p8: PEM, label: 'New' }),
    );
    expect(await runPushKeyEffect(listPushKeys())).toHaveLength(1);
    expect((await runPushKeyEffect(listPushKeys()))[0]?.label).toBe('New');
    expect(second.importedAt).toBe(first.importedAt);
  });
  it('finds a vaulted key case-insensitively and returns null for a missing secret', async () => {
    await runPushKeyEffect(importPushKey({ keyId: 'ABC123DEFG', p8: PEM }));
    expect((await runPushKeyEffect(findPushKey('abc123defg')))?.keyId).toBe('ABC123DEFG');
    expect(await runPushKeyEffect(findPushKey('NOPE'))).toBeUndefined();
    expect(await runPushKeyEffect(loadPushKey('NOPE'))).toBeNull();
  });
});
