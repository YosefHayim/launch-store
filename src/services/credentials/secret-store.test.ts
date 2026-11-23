import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LaunchSecretStore, resetSecretStore, useSecretStore } from './secret-store.ts';

const fakeKeyring = vi.hoisted(function hoistFakeKeyring() {
  return {
    storedPassword: null as string | null,
    isBroken: false,
  };
});

vi.mock('@napi-rs/keyring', function mockKeyring() {
  return {
    Entry: class {
      getPassword() {
        if (fakeKeyring.isBroken) throw new Error('Platform failure: the keyring is locked');
        return fakeKeyring.storedPassword;
      }
    },
  };
});

afterEach(function resetSecretFixture() {
  resetSecretStore();
});
function describeLaunchSecretStore() {
  async function storesReadsAndDeletesSecretsThroughTheTestMap() {
    const storedSecrets = new Map<string, string>();
    useSecretStore(storedSecrets);
    await LaunchSecretStore.storeSecret('review-password', 'secret-text');
    const storedSecret = await LaunchSecretStore.readSecret('review-password');
    await LaunchSecretStore.deleteSecret('review-password');
    const deletedSecret = await LaunchSecretStore.readSecret('review-password');

    expect({ storedSecret, deletedSecret }).toEqual({
      storedSecret: 'secret-text',
      deletedSecret: null,
    });
    expect(storedSecrets.size).toBe(0);
  }

  it(
    'stores, reads, and deletes secrets through the test map',
    storesReadsAndDeletesSecretsThroughTheTestMap,
  );
}

describe('LaunchSecretStore', describeLaunchSecretStore);
function describeLaunchSecretStoreNativeKeyring() {
  beforeEach(function resetKeyring() {
    fakeKeyring.storedPassword = null;
    fakeKeyring.isBroken = false;
    resetSecretStore();
  });
  async function readSecretReturnsNullWhenTheNativeKeyringHasNoPiece() {
    fakeKeyring.storedPassword = null;
    const storedSecret = await LaunchSecretStore.readSecret('review-password');
    expect(storedSecret).toBeNull();
  }

  it(
    'readSecret returns null when the native keyring has no entry',
    readSecretReturnsNullWhenTheNativeKeyringHasNoPiece,
  );
  async function readSecretFailsWithAClearMessageWhenTheNativeKeyringThrows() {
    fakeKeyring.isBroken = true;
    await expect(LaunchSecretStore.readSecret('review-password')).rejects.toThrow(
      'Could not read review-password from the keychain',
    );
  }

  it(
    'readSecret fails with a clear message when the native keyring throws',
    readSecretFailsWithAClearMessageWhenTheNativeKeyringThrows,
  );
}

describe('LaunchSecretStore native keyring', describeLaunchSecretStoreNativeKeyring);
