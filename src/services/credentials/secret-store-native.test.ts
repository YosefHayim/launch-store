import { describe, expect, it, vi } from 'vitest';
import { LaunchSecretStore } from './secret-store.ts';

vi.mock('../platform/host-operating-system.ts', function mockOs() {
  return {
    detectHostOperatingSystem: function detectHostOperatingSystem() {
      return 'macos';
    },
  };
});

vi.mock('../platform/execute-command.ts', function mockExec() {
  return {
    captureCommandOutput: vi.fn(async function capture(_command: string, args: string[]) {
      const isDeniedNull = args.includes('denied-null');

      if (isDeniedNull) {
        return 'metadata';
      }

      throw { exitCode: 44 };
    }),
  };
});

vi.mock('@napi-rs/keyring', function mockKeyring() {
  const secrets = new Map<string, string>();

  return {
    Entry: class {
      constructor(
        private service: string,
        private account: string,
      ) {}

      getPassword() {
        if (this.account == 'denied') throw new Error('access denied');

        if (this.account == 'denied-null') return null;

        return secrets.get(`${this.service}:${this.account}`) ?? null;
      }

      setPassword(secret: string) {
        secrets.set(`${this.service}:${this.account}`, secret);
      }

      deletePassword() {
        secrets.delete(`${this.service}:${this.account}`);
      }
    },
  };
});

function describeNativeSecretStoreWithAMockedBinding() {
  async function roundTripsAMultilineSecretAndReportsMissingEntries() {
    await LaunchSecretStore.storeSecret('test', 'dummy\nkey');
    expect(await LaunchSecretStore.readSecret('test')).toBe('dummy\nkey');
    await LaunchSecretStore.deleteSecret('test');
    expect(await LaunchSecretStore.readSecret('test')).toBeNull();
  }

  it(
    'round trips a multiline secret and reports missing entries',
    roundTripsAMultilineSecretAndReportsMissingEntries,
  );

  async function propagatesADeniedKeychainReadInsteadOfTreatingItAsMissing() {
    await expect(LaunchSecretStore.readSecret('denied')).rejects.toThrow(
      'Could not read denied from the keychain',
    );
  }

  it(
    'propagates a denied keychain read instead of treating it as missing',
    propagatesADeniedKeychainReadInsteadOfTreatingItAsMissing,
  );

  async function treatsNullFromAnExistingMacOSPieceAsAFailedRead() {
    await expect(LaunchSecretStore.readSecret('denied-null')).rejects.toThrow(
      'Could not read denied-null from the keychain',
    );
  }

  it(
    'treats null from an existing macOS item as a failed read',
    treatsNullFromAnExistingMacOSPieceAsAFailedRead,
  );
}

describe('native secret store with a mocked binding', describeNativeSecretStoreWithAMockedBinding);
