import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { LaunchSecretStore, LaunchSecretStoreLive } from './secretStore.js';

vi.mock('./os.js', () => ({ detectHostOperatingSystem: Effect.succeed('macos') }));
vi.mock('./exec.js', () => ({
  provideNodeCommandServices: (program: Effect.Effect<unknown, unknown>) => program,
  captureCommandOutput: vi.fn((_command: string, args: string[]) => {
    if (args.includes('denied-null')) return Effect.succeed('metadata');
    return Effect.fail({ exitCode: 44 });
  }),
}));

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
        if (this.account === 'denied-null') return null;
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
  it('treats null from an existing macOS item as a failed read', async () => {
    const result = await Effect.runPromise(
      Effect.either(
        Effect.gen(function* () {
          const store = yield* LaunchSecretStore;
          return yield* store.readSecret('denied-null');
        }).pipe(Effect.provide(LaunchSecretStoreLive)),
      ),
    );
    expect(result._tag).toBe('Left');
    if (result._tag !== 'Left') throw new Error('Expected failure');
    expect(String(result.left)).toContain('Could not read denied-null from the keychain');
  });
});
