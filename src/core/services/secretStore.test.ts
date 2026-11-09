import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import {
  LaunchSecretStore,
  LaunchSecretStoreLive,
  makeLaunchSecretStoreTest,
} from './secretStore.js';

const fakeHost = vi.hoisted(() => ({
  operatingSystem: 'macos' as 'macos' | 'linux',
  securityExitCode: 0,
}));

const fakeKeyring = vi.hoisted(() => ({
  storedPassword: null as string | null,
  isBroken: false,
}));

vi.mock('./os.js', async () => {
  const { Effect: EffectModule } = await import('effect');
  return { detectHostOperatingSystem: EffectModule.sync(() => fakeHost.operatingSystem) };
});

vi.mock('./exec.js', async () => {
  const { Effect: EffectModule } = await import('effect');
  return {
    provideNodeCommandServices: <TValue, TError>(program: Effect.Effect<TValue, TError>) => program,
    captureCommandOutput: () => {
      const isSecuritySuccessful = fakeHost.securityExitCode === 0;
      if (isSecuritySuccessful) return EffectModule.succeed('secret-text');
      return EffectModule.fail({
        _tag: 'CommandFailed',
        command: 'security',
        exitCode: fakeHost.securityExitCode,
        stderr: '',
      });
    },
  };
});

vi.mock('@napi-rs/keyring', () => ({
  Entry: class {
    getPassword() {
      if (fakeKeyring.isBroken) throw new Error('Platform failure: the keyring is locked');
      return fakeKeyring.storedPassword;
    }
  },
}));

const readSecretFromLiveStore = (account: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const secretStore = yield* LaunchSecretStore;
      const storedSecret = yield* secretStore.readSecret(account);
      return storedSecret;
    }).pipe(Effect.provide(LaunchSecretStoreLive)),
  );

describe('LaunchSecretStore', () => {
  it('stores, reads, and deletes secrets through the test layer', async () => {
    const storedSecrets = new Map<string, string>();
    const secretStoreProgram = Effect.gen(function* () {
      const secretStore = yield* LaunchSecretStore;
      yield* secretStore.storeSecret('review-password', 'secret-text');
      const storedSecret = yield* secretStore.readSecret('review-password');
      yield* secretStore.deleteSecret('review-password');
      const deletedSecret = yield* secretStore.readSecret('review-password');
      return { storedSecret, deletedSecret };
    }).pipe(Effect.provide(makeLaunchSecretStoreTest(storedSecrets)));

    await expect(Effect.runPromise(secretStoreProgram)).resolves.toEqual({
      storedSecret: 'secret-text',
      deletedSecret: null,
    });
    expect(storedSecrets.size).toBe(0);
  });
});

describe('LaunchSecretStoreLive', () => {
  beforeEach(() => {
    fakeHost.operatingSystem = 'macos';
    fakeHost.securityExitCode = 0;
    fakeKeyring.storedPassword = null;
    fakeKeyring.isBroken = false;
  });

  it('readSecret returns null when the macOS keychain has no such item', async () => {
    fakeHost.securityExitCode = 44;

    const storedSecret = await readSecretFromLiveStore('review-password');

    expect(storedSecret).toBeNull();
  });

  it('readSecret fails with a clear message when security fails for another reason', async () => {
    fakeHost.securityExitCode = 1;

    const readAttempt = readSecretFromLiveStore('review-password');

    await expect(readAttempt).rejects.toThrow('Could not read review-password from the keychain');
  });

  it('readSecret returns null when the Windows or Linux keyring has no entry', async () => {
    fakeHost.operatingSystem = 'linux';
    fakeKeyring.storedPassword = null;

    const storedSecret = await readSecretFromLiveStore('review-password');

    expect(storedSecret).toBeNull();
  });

  it('readSecret fails with a clear message when the Windows or Linux keyring throws', async () => {
    fakeHost.operatingSystem = 'linux';
    fakeKeyring.isBroken = true;

    const readAttempt = readSecretFromLiveStore('review-password');

    await expect(readAttempt).rejects.toThrow('Could not read review-password from the keychain');
  });
});
