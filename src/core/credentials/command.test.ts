import { NodeContext } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  credentialSearchDirectories,
  CredentialsCommandInputSchema,
  isCredentialDiscoveryFile,
} from './command.js';

const discoveryFixture = (filePath: string) =>
  Effect.gen(function* () {
    const searchDirectories = yield* credentialSearchDirectories(
      '/Users/example',
      '/workspace/app',
    );
    return yield* isCredentialDiscoveryFile(filePath, searchDirectories);
  }).pipe(Effect.provide(NodeContext.layer));

describe('credential discovery directories', () => {
  it('matches a key directly inside Downloads', async () => {
    await expect(
      Effect.runPromise(discoveryFixture('/Users/example/Downloads/AuthKey_ABC123.p8')),
    ).resolves.toBe(true);
  });

  it('matches a service-account key directly inside the working directory', async () => {
    await expect(
      Effect.runPromise(discoveryFixture('/workspace/app/service-account.json')),
    ).resolves.toBe(true);
  });

  it('leaves a deliberately placed key outside discovery directories untouched', async () => {
    await expect(
      Effect.runPromise(discoveryFixture('/Users/example/vault/AuthKey_ABC123.p8')),
    ).resolves.toBe(false);
  });

  it('does not match a key nested below a discovery directory', async () => {
    await expect(
      Effect.runPromise(discoveryFixture('/Users/example/Downloads/keys/AuthKey_ABC123.p8')),
    ).resolves.toBe(false);
  });
});

describe('CredentialsCommandInputSchema', () => {
  it('decodes the Commander boundary into a known credential action', () => {
    expect(
      Schema.decodeUnknownSync(CredentialsCommandInputSchema)({
        action: 'setup',
        options: { platform: 'android', yes: true },
      }),
    ).toEqual({
      action: 'setup',
      options: { platform: 'android', yes: true },
    });
  });

  it('rejects an unknown credential action before orchestration', () => {
    expect(() =>
      Schema.decodeUnknownSync(CredentialsCommandInputSchema)({
        action: 'erase-everything',
        options: {},
      }),
    ).toThrow();
  });
});
