/**
 * Tests for Android credential storage — the base64-at-rest encoding of the service-account JSON
 * (the same macOS `security -w` hex-corruption fix as the iOS `.p8`) and the status summary. The
 * secret store is mocked with an in-memory map so these run anywhere with no real keychain calls.
 * HOME is redirected before paths resolve so a developer machine's real upload keystore never leaks
 * into "fresh machine" assertions.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';

// Redirect HOME before `core/services/paths.js` evaluates so `~/.launch/credentials/android.json`
// resolves under a throwaway path. Must run via vi.hoisted before the static imports below; use the
// global `process` (not a node:process import) so hoisting does not hit a TDZ on the import binding.
const { store, homeDir } = vi.hoisted(() => {
  const homeDir = `${process.env['TMPDIR'] ?? '/tmp'}/launch-android-credentials-test-${process.pid}`;
  process.env['HOME'] = homeDir;
  process.env['USERPROFILE'] = homeDir;
  return { store: new Map<string, string>(), homeDir };
});

vi.mock('../core/credentials/keychain.js', () => ({
  setSecret: async (account: string, value: string): Promise<void> => {
    store.set(account, value);
  },
  getSecret: async (account: string): Promise<string | null> => store.get(account) ?? null,
  deleteSecret: async (account: string): Promise<void> => {
    store.delete(account);
  },
}));

import {
  describeStoredAndroidCredentials,
  loadServiceAccount,
  storeServiceAccount,
} from './credentials.js';

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
    await storeServiceAccount(SERVICE_ACCOUNT);
    const stored = store.get('play-service-account');
    expect(stored).toBeDefined();
    expect(stored).not.toContain('\n');
    expect(stored).not.toBe(SERVICE_ACCOUNT);
  });

  it('round-trips a multi-line key through store → load unchanged', async () => {
    await storeServiceAccount(SERVICE_ACCOUNT);
    expect(await loadServiceAccount()).toBe(SERVICE_ACCOUNT);
  });

  it('validates the key shape before storing anything', async () => {
    await expect(storeServiceAccount(JSON.stringify({ type: 'authorized_user' }))).rejects.toThrow(
      /client_email.*private_key/,
    );
    expect(store.size).toBe(0);
  });

  it('returns null when no service account has been imported', async () => {
    expect(await loadServiceAccount()).toBeNull();
  });
});

describe('describeStoredAndroidCredentials', () => {
  it('reports nothing cached on a fresh machine', async () => {
    expect(await describeStoredAndroidCredentials()).toEqual({
      keystoreAlias: null,
      hasServiceAccount: false,
    });
  });

  it('reports the service account once imported', async () => {
    await storeServiceAccount(SERVICE_ACCOUNT);
    const { hasServiceAccount, keystoreAlias } = await describeStoredAndroidCredentials();
    expect(hasServiceAccount).toBe(true);
    expect(keystoreAlias).toBeNull();
  });
});
