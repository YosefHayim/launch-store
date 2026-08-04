import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import type { StorageProvider } from '../types/providers.js';
import { getStorageProvider, registerStorageProvider } from './registry.js';
/** A throwaway storage provider for exercising the registry without touching disk. */
const fakeStorage = (name: string): StorageProvider => {
  return {
    name,
    put: () => Effect.dieMessage('not used'),
    list: () => Effect.succeed([]),
    url: () => Effect.succeed(''),
    putObject: () => Effect.dieMessage('not used'),
    getObject: () => Effect.succeed(null),
    publicUrl: () => '',
  };
};
describe('provider registry - the DI seam', () => {
  it('registers a provider and looks it up by name', () => {
    const provider = fakeStorage('memory');
    registerStorageProvider(provider);
    expect(Effect.runSync(getStorageProvider('memory'))).toBe(provider);
  });
  it('throws a clear error naming the available providers when one is missing', () => {
    registerStorageProvider(fakeStorage('local'));
    expect(() => Effect.runSync(getStorageProvider('nonexistent'))).toThrow(
      /ProviderNotRegistered/,
    );
  });
});
