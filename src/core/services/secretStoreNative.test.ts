import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { LaunchSecretStore, LaunchSecretStoreLive } from './secretStore.js';

vi.mock('@napi-rs/keyring', () => {
  const secrets = new Map<string, string>();
  return {
    Entry: class {
      constructor(
        private service: string,
        private account: string,
      ) {}
      getPassword() {
        if (this.account === 'denied') throw new Error('access denied');
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

describe('native secret store with a mocked binding', () => {
  it('round trips a multiline secret and reports missing entries', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* LaunchSecretStore;
        yield* store.storeSecret('test', 'dummy\nkey');
        expect(yield* store.readSecret('test')).toBe('dummy\nkey');
        yield* store.deleteSecret('test');
        expect(yield* store.readSecret('test')).toBeNull();
      }).pipe(Effect.provide(LaunchSecretStoreLive)),
    );
  });
  it('propagates a denied keychain read instead of treating it as missing', async () => {
    const result = await Effect.runPromise(
      Effect.either(
        Effect.gen(function* () {
          const store = yield* LaunchSecretStore;
          return yield* store.readSecret('denied');
        }).pipe(Effect.provide(LaunchSecretStoreLive)),
      ),
    );
    expect(result._tag).toBe('Left');
  });
});
