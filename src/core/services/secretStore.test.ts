import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { LaunchSecretStore, makeLaunchSecretStoreTest } from './secretStore.js';

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
