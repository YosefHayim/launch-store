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
const systemTemporaryDirectory = tmpdir();
const homeDirectory = join(
  systemTemporaryDirectory,
  `launch-android-credentials-test-${process.pid}`,
);

const SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  client_email: 'launch@proj.iam.gserviceaccount.com',
  private_key:
    '-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBg\nkqhkiG9w0BAQ\n-----END PRIVATE KEY-----\n',
  token_uri: 'https://oauth2.googleapis.com/token',
});
function prepare() {
  secrets.clear();
  useLaunchDirectories({ homeDirectory, workingDirectory: homeDirectory });
  useSecretStore(secrets);
  rmSync(homeDirectory, { recursive: true, force: true });
}

beforeEach(prepare);
function cleanupAll() {
  resetLaunchDirectories();
  resetSecretStore();
  rmSync(homeDirectory, { recursive: true, force: true });
}

afterAll(cleanupAll);
function describeStoreServiceAccountLoadServiceAccount() {
  async function storesTheJSONAsASingleBase64LineSoSecurityWCannotHexEncodeIt() {
    await storeServiceAccount(SERVICE_ACCOUNT, 'com.example.app');

    const stored = secrets.get('play-service-account:com.example.app');

    expect(stored).toBeDefined();
    expect(stored).not.toContain('\n');
    expect(stored).not.toBe(SERVICE_ACCOUNT);
  }

  it(
    'stores the JSON as a single base64 line so `security -w` cannot hex-encode it',
    storesTheJSONAsASingleBase64LineSoSecurityWCannotHexEncodeIt,
  );
  async function roundTripsAMultiLineKeyThroughStoreLoadUnchanged() {
    await storeServiceAccount(SERVICE_ACCOUNT, 'com.example.app');

    const serviceAccount = await loadServiceAccount('com.example.app');
    expect(serviceAccount).toBe(SERVICE_ACCOUNT);
  }

  it(
    'round-trips a multi-line key through store -> load unchanged',
    roundTripsAMultiLineKeyThroughStoreLoadUnchanged,
  );
  async function validatesTheKeyShapeBeforeStoringAnything() {
    const serialized = JSON.stringify({ type: 'authorized_user' });
    await expect(storeServiceAccount(serialized, 'com.example.app')).rejects.toMatchObject({
      message: expect.stringMatching(/client_email.*private_key/),
    });
    expect(secrets.size).toBe(0);
  }

  it('validates the key shape before storing anything', validatesTheKeyShapeBeforeStoringAnything);
  async function returnsNullWhenNoServiceAccountHasBeenImported() {
    const serviceAccount = await loadServiceAccount('com.example.app');
    expect(serviceAccount).toBeNull();
  }

  it(
    'returns null when no service account has been imported',
    returnsNullWhenNoServiceAccountHasBeenImported,
  );
}

describe('storeServiceAccount / loadServiceAccount', describeStoreServiceAccountLoadServiceAccount);
function describeDescribeStoredAndroidCredentials() {
  async function reportsNothingCachedOnAFreshMachine() {
    const storedAndroidCredentials = await describeStoredAndroidCredentials('com.example.app');
    expect(storedAndroidCredentials).toEqual({
      keystoreAlias: null,
      hasServiceAccount: false,
    });
  }

  it('reports nothing cached on a fresh machine', reportsNothingCachedOnAFreshMachine);
  async function reportsTheServiceAccountOnceImported() {
    await storeServiceAccount(SERVICE_ACCOUNT, 'com.example.app');

    const { hasServiceAccount, keystoreAlias } =
      await describeStoredAndroidCredentials('com.example.app');

    expect(hasServiceAccount).toBe(true);
    expect(keystoreAlias).toBeNull();
  }

  it('reports the service account once imported', reportsTheServiceAccountOnceImported);
  async function failsInsteadOfReadingACorruptCredentialsIndexAsEmpty() {
    const indexPath = resolveAndroidCredentialsIndexPath('com.example.app');

    const parentDirectory = dirname(indexPath);
    mkdirSync(parentDirectory, { recursive: true });
    writeFileSync(indexPath, '{ "keystore": ');

    const storedAndroidCredentials = describeStoredAndroidCredentials('com.example.app');
    await expect(storedAndroidCredentials).rejects.toMatchObject({
      _tag: 'AndroidCredentialFailure',
      message: expect.stringContaining('is corrupt'),
    });
  }

  it(
    'fails instead of reading a corrupt credentials index as empty',
    failsInsteadOfReadingACorruptCredentialsIndexAsEmpty,
  );
}

describe('describeStoredAndroidCredentials', describeDescribeStoredAndroidCredentials);
function describeLegacyAndroidRecoveryGuidance() {
  async function namesTheSelectedAppAndDistinguishesAnUploadKeystoreFromAPlayKey() {
    secrets.set('android-keystore-store-password', 'fixture');

    const message = await describeMissingPlayServiceAccount('demo');

    expect(message).toContain('Legacy upload keystore passwords');
    expect(message).toContain("launch-store creds adopt --platform android --app 'demo'");
    expect(message).not.toContain('legacy Play service account');
  }

  it(
    'names the selected app and distinguishes an upload keystore from a Play key',
    namesTheSelectedAppAndDistinguishesAnUploadKeystoreFromAPlayKey,
  );
  async function quotesAppHandlesSafelyInTheAdoptionCommand() {
    secrets.set('play-service-account', 'fixture');

    const message = await describeMissingPlayServiceAccount("Dylan's App");

    expect(message).toContain("--app 'Dylan'\\''s App'");
  }

  it(
    'quotes app handles safely in the adoption command',
    quotesAppHandlesSafelyInTheAdoptionCommand,
  );
}

describe('legacy Android recovery guidance', describeLegacyAndroidRecoveryGuidance);
