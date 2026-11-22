import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetSecretStore, useSecretStore } from '../services/credentials/secret-store.ts';
import {
  resetLaunchDirectories,
  resolveAndroidCredentialsIndexPath,
  useLaunchDirectories,
} from '../services/platform/paths.ts';
import {
  describeMissingPlayServiceAccount,
  describeStoredAndroidCredentials,
  loadServiceAccount,
  storeServiceAccount,
} from './android-keystore-assets.ts';

const secrets = new Map<string, string>();
const homeDirectory = join(tmpdir(), `launch-android-credentials-test-${process.pid}`);

const SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  client_email: 'launch@proj.iam.gserviceaccount.com',
  private_key:
    '-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBg\nkqhkiG9w0BAQ\n-----END PRIVATE KEY-----\n',
  token_uri: 'https://oauth2.googleapis.com/token',
});

beforeEach(() => {
  secrets.clear();
  useLaunchDirectories({ homeDirectory, workingDirectory: homeDirectory });
  useSecretStore(secrets);
  rmSync(homeDirectory, { recursive: true, force: true });
});

afterAll(() => {
  resetLaunchDirectories();
  resetSecretStore();
  rmSync(homeDirectory, { recursive: true, force: true });
});

describe('storeServiceAccount / loadServiceAccount', () => {
  it('stores the JSON as a single base64 line so `security -w` cannot hex-encode it', async () => {
    await storeServiceAccount(SERVICE_ACCOUNT, 'com.example.app');

    const stored = secrets.get('play-service-account:com.example.app');

    expect(stored).toBeDefined();
    expect(stored).not.toContain('\n');
    expect(stored).not.toBe(SERVICE_ACCOUNT);
  });

  it('round-trips a multi-line key through store -> load unchanged', async () => {
    await storeServiceAccount(SERVICE_ACCOUNT, 'com.example.app');

    expect(await loadServiceAccount('com.example.app')).toBe(SERVICE_ACCOUNT);
  });

  it('validates the key shape before storing anything', async () => {
    await expect(
      storeServiceAccount(JSON.stringify({ type: 'authorized_user' }), 'com.example.app'),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/client_email.*private_key/),
    });
    expect(secrets.size).toBe(0);
  });

  it('returns null when no service account has been imported', async () => {
    expect(await loadServiceAccount('com.example.app')).toBeNull();
  });
});

describe('describeStoredAndroidCredentials', () => {
  it('reports nothing cached on a fresh machine', async () => {
    expect(await describeStoredAndroidCredentials('com.example.app')).toEqual({
      keystoreAlias: null,
      hasServiceAccount: false,
    });
  });

  it('reports the service account once imported', async () => {
    await storeServiceAccount(SERVICE_ACCOUNT, 'com.example.app');

    const { hasServiceAccount, keystoreAlias } =
      await describeStoredAndroidCredentials('com.example.app');

    expect(hasServiceAccount).toBe(true);
    expect(keystoreAlias).toBeNull();
  });

  it('fails instead of reading a corrupt credentials index as empty', async () => {
    const indexPath = resolveAndroidCredentialsIndexPath('com.example.app');

    mkdirSync(dirname(indexPath), { recursive: true });
    writeFileSync(indexPath, '{ "keystore": ');

    await expect(describeStoredAndroidCredentials('com.example.app')).rejects.toMatchObject({
      _tag: 'AndroidCredentialFailure',
      message: expect.stringContaining('is corrupt'),
    });
  });
});

describe('legacy Android recovery guidance', () => {
  it('names the selected app and distinguishes an upload keystore from a Play key', async () => {
    secrets.set('android-keystore-store-password', 'fixture');

    const message = await describeMissingPlayServiceAccount('demo');

    expect(message).toContain('Legacy upload keystore passwords');
    expect(message).toContain("launch creds adopt --platform android --app 'demo'");
    expect(message).not.toContain('legacy Play service account');
  });

  it('quotes app handles safely in the adoption command', async () => {
    secrets.set('play-service-account', 'fixture');

    const message = await describeMissingPlayServiceAccount("Dylan's App");

    expect(message).toContain("--app 'Dylan'\\''s App'");
  });
});
