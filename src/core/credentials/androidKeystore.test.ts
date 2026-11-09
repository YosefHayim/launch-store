import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { Effect } from 'effect';
import { NodeContext } from '@effect/platform-node';
import {
  makeLaunchSecretStoreTest,
  type LaunchSecretStoreService,
} from '../services/secretStore.js';
// Redirect HOME before `core/services/paths.js` evaluates so `~/.launch/credentials/android.json`
// resolves under a throwaway path. Must run via vi.hoisted before the static imports below; use the
// global `process` (not a node:process import) so hoisting does not hit a TDZ on the import binding.
const { store, homeDir } = vi.hoisted(() => {
  let temporaryDirectory = process.env['TMPDIR'];
  if (temporaryDirectory === undefined) temporaryDirectory = '/tmp';
  const homeDir = `${temporaryDirectory}/launch-android-credentials-test-${process.pid}`;
  process.env['HOME'] = homeDir;
  process.env['USERPROFILE'] = homeDir;
  return { store: new Map<string, string>(), homeDir };
});
vi.mock('./keychain.js', () => ({
  setSecret: (account: string, secretText: string) =>
    Effect.sync(() => void store.set(account, secretText)),
  getSecret: (account: string) =>
    Effect.sync(() => {
      const storedSecret = store.get(account);
      if (storedSecret === undefined) return null;
      return storedSecret;
    }),
  deleteSecret: (account: string) => Effect.sync(() => void store.delete(account)),
}));
import {
  describeStoredAndroidCredentials,
  loadServiceAccount,
  missingPlayServiceAccountMessage,
  storeServiceAccount,
} from './androidKeystore.js';
import { makeLaunchPathsTest, type LaunchPathsService } from '../services/paths.js';
/** Run an Android credential program with an isolated secret-store capability. */
const runAndroidCredentialEffect = <TValue, TError>(
  credentialEffect: Effect.Effect<
    TValue,
    TError,
    LaunchPathsService | LaunchSecretStoreService | NodeContext.NodeContext
  >,
): Promise<TValue> => {
  return Effect.runPromise(
    credentialEffect.pipe(
      Effect.provide(NodeContext.layer),
      Effect.provide(makeLaunchPathsTest(homeDir, homeDir)),
      Effect.provide(makeLaunchSecretStoreTest()),
    ),
  );
};
/** A valid-shaped service-account key (multi-line PEM is the exact case that triggered the hex bug). */
const SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  client_email: 'launch@proj.iam.gserviceaccount.com',
  private_key:
    '-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBg\nkqhkiG9w0BAQ\n-----END PRIVATE KEY-----\n',
  token_uri: 'https://oauth2.googleapis.com/token',
});
beforeEach(() => {
  store.clear();
  rmSync(homeDir, { recursive: true, force: true });
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(() => {
  rmSync(homeDir, { recursive: true, force: true });
});
describe('storeServiceAccount / loadServiceAccount', () => {
  it('stores the JSON as a single base64 line so `security -w` cannot hex-encode it', async () => {
    await runAndroidCredentialEffect(storeServiceAccount(SERVICE_ACCOUNT, 'com.example.app'));
    const stored = store.get('play-service-account:com.example.app');
    expect(stored).toBeDefined();
    expect(stored).not.toContain('\n');
    expect(stored).not.toBe(SERVICE_ACCOUNT);
  });
  it('round-trips a multi-line key through store -> load unchanged', async () => {
    await runAndroidCredentialEffect(storeServiceAccount(SERVICE_ACCOUNT, 'com.example.app'));
    expect(await runAndroidCredentialEffect(loadServiceAccount('com.example.app'))).toBe(
      SERVICE_ACCOUNT,
    );
  });
  it('validates the key shape before storing anything', async () => {
    await expect(
      runAndroidCredentialEffect(
        storeServiceAccount(JSON.stringify({ type: 'authorized_user' }), 'com.example.app'),
      ),
    ).rejects.toThrow(/client_email.*private_key/);
    expect(store.size).toBe(0);
  });
  it('returns null when no service account has been imported', async () => {
    expect(await runAndroidCredentialEffect(loadServiceAccount('com.example.app'))).toBeNull();
  });
});
describe('describeStoredAndroidCredentials', () => {
  it('reports nothing cached on a fresh machine', async () => {
    expect(
      await runAndroidCredentialEffect(describeStoredAndroidCredentials('com.example.app')),
    ).toEqual({
      keystoreAlias: null,
      hasServiceAccount: false,
    });
  });
  it('reports the service account once imported', async () => {
    await runAndroidCredentialEffect(storeServiceAccount(SERVICE_ACCOUNT, 'com.example.app'));
    const { hasServiceAccount, keystoreAlias } = await runAndroidCredentialEffect(
      describeStoredAndroidCredentials('com.example.app'),
    );
    expect(hasServiceAccount).toBe(true);
    expect(keystoreAlias).toBeNull();
  });
});

describe('legacy Android recovery guidance', () => {
  it('names the selected app and distinguishes an upload keystore from a Play key', async () => {
    store.set('android-keystore-store-password', 'fixture');
    const message = await runAndroidCredentialEffect(missingPlayServiceAccountMessage('demo'));
    expect(message).toContain('Legacy upload keystore passwords');
    expect(message).toContain("launch creds adopt --platform android --app 'demo'");
    expect(message).not.toContain('legacy Play service account');
  });
  it('quotes app handles safely in the adoption command', async () => {
    store.set('play-service-account', 'fixture');
    const message = await runAndroidCredentialEffect(
      missingPlayServiceAccountMessage("Dylan's App"),
    );
    expect(message).toContain("--app 'Dylan'\\''s App'");
  });
});
