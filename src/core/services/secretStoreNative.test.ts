import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { LaunchSecretStore, LaunchSecretStoreLive } from './secretStore.js';

vi.mock('@napi-rs/keyring', () => {
  const secrets = new Map<string, string>();
  return {
    Entry: class {
      private coordinate: string;
      constructor(service: string, account: string) {
        this.coordinate = `${service}:${account}`;
      }
      getPassword() {
        const secret = secrets.get(this.coordinate);
        if (secret === undefined) throw new Error('No entry');
        return secret;
      }
      setPassword(secret: string) {
        secrets.set(this.coordinate, secret);
      }
      deletePassword() {
        secrets.delete(this.coordinate);
      }
    },
  };
});

describe('native secret storage on every supported platform', () => {
  it('stores multiline keys through the native binding without a security CLI subprocess', async () => {
    const storedKey = await Effect.runPromise(
      Effect.gen(function* () {
        const secretStore = yield* LaunchSecretStore;
        const privateKey = 'dummy\nmultiline\nkey';
        yield* secretStore.storeSecret('isolated-native-test', privateKey);
        const roundTrip = yield* secretStore.readSecret('isolated-native-test');
        yield* secretStore.deleteSecret('isolated-native-test');
        expect(yield* secretStore.readSecret('isolated-native-test')).toBeNull();
        return roundTrip;
      }).pipe(Effect.provide(LaunchSecretStoreLive)),
    );
    expect(storedKey).toBe('dummy\nmultiline\nkey');
  });
});
