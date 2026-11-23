import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { ARTIFACTS_DIR } from '../services/platform/paths.ts';
import {
  registerStorageProvider,
  registerStorageProviderResolver,
} from '../services/provider-support/registry.ts';
import type { BuildArtifact } from '../types/artifacts.ts';
import type { LaunchConfig } from '../types/config.ts';
import type { StorageProvider } from '../types/providers.ts';
import {
  ensureArtifactPresent,
  isCloudStorage,
  resolveArtifactDir,
  resolveStorageProvider,
} from './storage.ts';

function makeStorageProvider(name: string, publicBaseUrl = 'file://test'): StorageProvider {
  return {
    name,
    put() {
      return Promise.reject(new Error('unused'));
    },
    list() {
      return Promise.resolve([]);
    },
    url() {
      return Promise.reject(new Error('unused'));
    },
    putObject() {
      return Promise.reject(new Error('unused'));
    },
    getObject() {
      return Promise.resolve(null);
    },
    publicUrl(objectKey) {
      return `${publicBaseUrl.replace(/\/$/, '')}/${objectKey.replace(/^\//, '')}`;
    },
  };
}

function makeStorageResolver(name: string) {
  return {
    name,
    resolveStorageProvider() {
      const storageProvider = makeStorageProvider(name);
      return Promise.resolve(storageProvider);
    },
  };
}

function prepareAll() {
  const storageResolver = makeStorageResolver('local');

  registerStorageProviderResolver(storageResolver);

  const storageProvider = makeStorageProvider('local');

  registerStorageProvider(storageProvider);
}

beforeAll(prepareAll);

function configWith(storage: string): LaunchConfig {
  return {
    profiles: { production: { name: 'production' } },
    credentials: 'local',
    storage,
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };
}

function describeResolveStorageProvider() {
  async function returnsTheLocalProviderForLocal() {
    const storageProvider = await resolveStorageProvider(configWith('local'));
    expect(storageProvider.name).toBe('local');
  }

  it('returns the local provider for `local`', returnsTheLocalProviderForLocal);

  async function rejectsStorageOtherThanLocal() {
    const storageProvider = resolveStorageProvider(configWith('other'));
    await expect(storageProvider).rejects.toThrow(/only local artifact storage/i);
  }

  it('rejects storage other than local', rejectsStorageOtherThanLocal);
}

describe('resolveStorageProvider', describeResolveStorageProvider);

function describeResolveArtifactDir() {
  function fallsBackToTheGlobalLaunchArtifactsWhenUnsetBackCompat() {
    const artifactDir = resolveArtifactDir(undefined);
    expect(artifactDir).toBe(ARTIFACTS_DIR);
  }

  it(
    'falls back to the global ~/.launch/artifacts when unset (back-compat)',
    fallsBackToTheGlobalLaunchArtifactsWhenUnsetBackCompat,
  );

  function failsOnAnEmptyStringALikelyPieceTypo() {
    function callResolveArtifactDir() {
      return resolveArtifactDir('   ');
    }

    expect(callResolveArtifactDir).toThrow(/must not be empty/);
  }

  it('fails on an empty string - a likely config typo', failsOnAnEmptyStringALikelyPieceTypo);

  function expandsALoneToTheHomeDirectory() {
    const artifactDir = resolveArtifactDir('~');
    const homeDirectory = homedir();
    expect(artifactDir).toBe(homeDirectory);
  }

  it('expands a lone ~ to the home directory', expandsALoneToTheHomeDirectory);

  function expandsALeadingAgainstTheHomeDirectory() {
    const artifactDir = resolveArtifactDir('~/builds/out');
    const homeDirectory = homedir();
    const absolutePath = resolve(homeDirectory, 'builds/out');
    expect(artifactDir).toBe(absolutePath);
  }

  it('expands a leading ~/ against the home directory', expandsALeadingAgainstTheHomeDirectory);

  function keepsAnAbsolutePathAsIs() {
    const artifactDir = resolveArtifactDir('/var/launch/artifacts');
    expect(artifactDir).toBe('/var/launch/artifacts');
  }

  it('keeps an absolute path as-is', keepsAnAbsolutePathAsIs);

  function resolvesARelativePathAgainstTheProjectRoot() {
    const artifactDir = resolveArtifactDir('./.launch/artifacts', '/repo');
    const absolutePath = resolve('/repo', '.launch/artifacts');
    expect(artifactDir).toBe(absolutePath);
  }

  it(
    'resolves a relative path against the project root',
    resolvesARelativePathAgainstTheProjectRoot,
  );
}

describe('resolveArtifactDir', describeResolveArtifactDir);

function describeIsCloudStorage() {
  function isFalseOnlyForLocalStorage() {
    expect(isCloudStorage(configWith('local'))).toBe(false);
    expect(isCloudStorage(configWith('other'))).toBe(true);
  }

  it('is false only for local storage', isFalseOnlyForLocalStorage);
}

describe('isCloudStorage', describeIsCloudStorage);

function describeEnsureArtifactPresent() {
  function storedBuild(overrides: Partial<BuildArtifact> = {}): BuildArtifact {
    return {
      path: fileURLToPath(import.meta.url),
      platform: 'android',
      appName: 'Hello',
      profile: 'production',
      version: '1.0.0',
      buildNumber: 7,
      sizeReport: { artifactBytes: 0, entries: [] },
      clean: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  async function passesWhenTheArtifactSBinaryIsStillOnDisk() {
    const buildProgram = storedBuild();
    const artifactPresent = ensureArtifactPresent(buildProgram, 'Hello', 'android');
    await expect(artifactPresent).resolves.toBeUndefined();
  }

  it(
    "passes when the artifact's binary is still on disk",
    passesWhenTheArtifactSBinaryIsStillOnDisk,
  );

  async function failsWhenTheArtifactWasPrunedToReclaimDisk() {
    const buildProgram = storedBuild({ prunedAt: '2026-01-02T00:00:00.000Z' });
    const artifactPresent = ensureArtifactPresent(buildProgram, 'Hello', 'android');
    await expect(artifactPresent).rejects.toThrow(/rebuild before releasing/);
  }

  it(
    'fails when the artifact was pruned to reclaim disk',
    failsWhenTheArtifactWasPrunedToReclaimDisk,
  );

  async function failsWhenTheRecordedBinaryIsMissingFromDisk() {
    const buildProgram = storedBuild({ path: '/no/such/build.aab' });
    const artifactPresent = ensureArtifactPresent(buildProgram, 'Hello', 'android');
    await expect(artifactPresent).rejects.toThrow(/pruned to reclaim disk/);
  }

  it(
    'fails when the recorded binary is missing from disk',
    failsWhenTheRecordedBinaryIsMissingFromDisk,
  );
}

describe('ensureArtifactPresent', describeEnsureArtifactPresent);
