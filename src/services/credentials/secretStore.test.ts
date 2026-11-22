import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LaunchSecretStore, resetSecretStore, useSecretStore } from './secretStore.ts';

const fakeKeyring = vi.hoisted(() => ({
  storedPassword: null as string | null,
  isBroken: false,
}));

vi.mock('@napi-rs/keyring', () => ({
  Entry: class {
    getPassword() {
      if (fakeKeyring.isBroken) throw new Error('Platform failure: the keyring is locked');
      return fakeKeyring.storedPassword;
    }
  },
}));

afterEach(function resetSecretFixture() {
  resetSecretStore();
});

describe('LaunchSecretStore', () => {
  it('stores, reads, and deletes secrets through the test map', async () => {
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
  });
});

describe('LaunchSecretStore native keyring', () => {
  beforeEach(function resetKeyring() {
    fakeKeyring.storedPassword = null;
    fakeKeyring.isBroken = false;
    resetSecretStore();
  });

  it('readSecret returns null when the native keyring has no entry', async () => {
    fakeKeyring.storedPassword = null;
    const storedSecret = await LaunchSecretStore.readSecret('review-password');
    expect(storedSecret).toBeNull();
  });

  it('readSecret fails with a clear message when the native keyring throws', async () => {
    fakeKeyring.isBroken = true;
    await expect(LaunchSecretStore.readSecret('review-password')).rejects.toThrow(
      'Could not read review-password from the keychain',
    );
  });
});
