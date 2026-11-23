import { describe, expect, it } from 'vitest';
import type { StorageProvider } from '../../types/providers.ts';
import {
  getBuildEngine,
  getStorageProvider,
  registerBuildEngine,
  registerStorageProvider,
} from './registry.ts';

function unusedStorageCall(): Promise<never> {
  return Promise.reject(new Error('not used'));
}

/** A throwaway storage provider for exercising the registry without touching disk. */
function fakeStorage(name: string): StorageProvider {
  return {
    name,
    put: unusedStorageCall,
    async list() {
      return [];
    },
    async url() {
      return '';
    },
    putObject: unusedStorageCall,
    async getObject() {
      return null;
    },
    publicUrl() {
      return '';
    },
  };
}
function describeProviderRegistryTheDISeam() {
  function registersAProviderAndLooksItUpByName() {
    const provider = fakeStorage('memory');
    registerStorageProvider(provider);
    const storageProvider = getStorageProvider('memory');
    expect(storageProvider).toBe(provider);
  }

  it('registers a provider and looks it up by name', registersAProviderAndLooksItUpByName);

  function throwsAClearErrorNamingTheAvailableProvidersWhenOneIsMissing() {
    registerStorageProvider(fakeStorage('local'));

    let failure: unknown = null;

    try {
      getStorageProvider('nonexistent');
    } catch (caught) {
      failure = caught;
    }

    expect(failure).toMatchObject({ _tag: 'ProviderNotRegistered' });
  }

  it(
    'throws a clear error naming the available providers when one is missing',
    throwsAClearErrorNamingTheAvailableProvidersWhenOneIsMissing,
  );

  function rejectsTheRetiredFastlaneBuildEngineNameAndNamesTheValidEngines() {
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
  }

  it(
    'rejects the retired fastlane build engine name and names the valid engines',
    rejectsTheRetiredFastlaneBuildEngineNameAndNamesTheValidEngines,
  );
}

describe('provider registry - the DI seam', describeProviderRegistryTheDISeam);
