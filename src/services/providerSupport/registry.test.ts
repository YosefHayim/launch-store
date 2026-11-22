import { describe, expect, it } from 'vitest';
import type { StorageProvider } from '../../types/providers.js';
import {
  getBuildEngine,
  getStorageProvider,
  registerBuildEngine,
  registerStorageProvider,
} from './registry.js';

function unusedStorageCall(): Promise<never> {
  return Promise.reject(new Error('not used'));
}

/** A throwaway storage provider for exercising the registry without touching disk. */
const fakeStorage = (name: string): StorageProvider => {
  return {
    name,
    put: unusedStorageCall,
    list: async () => [],
    url: async () => '',
    putObject: unusedStorageCall,
    getObject: async () => null,
    publicUrl: () => '',
  };
};
describe('provider registry - the DI seam', () => {
  it('registers a provider and looks it up by name', () => {
    const provider = fakeStorage('memory');
    registerStorageProvider(provider);
    expect(getStorageProvider('memory')).toBe(provider);
  });
  it('throws a clear error naming the available providers when one is missing', () => {
    registerStorageProvider(fakeStorage('local'));
    let failure: unknown = null;

    try {
      getStorageProvider('nonexistent');
    } catch (caught) {
      failure = caught;
    }

    expect(failure).toMatchObject({ _tag: 'ProviderNotRegistered' });
  });
  it('rejects the retired fastlane build engine name and names the valid engines', () => {
    registerBuildEngine({ name: 'xcode', buildArtifact: unusedStorageCall });
    registerBuildEngine({ name: 'gradle', buildArtifact: unusedStorageCall });
    let failure: unknown = null;

    try {
      getBuildEngine('fastlane');
    } catch (caught) {
      failure = caught;
    }

    expect(failure).toMatchObject({
      _tag: 'ProviderNotRegistered',
      message: 'Unknown build engine "fastlane". Valid build engines: xcode, gradle.',
    });
  });
});
