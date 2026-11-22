import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { ARTIFACTS_DIR } from '../services/platform/paths.ts';
import {
  getStorageProvider,
  registerStorageProvider,
  registerStorageProviderResolver,
} from '../services/provider-support/registry.ts';
import type { BuildArtifact } from '../types/artifacts.ts';
import type { LaunchConfig, StorageConfig } from '../types/config.ts';
import type { StorageProvider, StorageProviderOptions } from '../types/providers.ts';
import {
  ensureArtifactPresent,
  isCloudStorage,
  resolveArtifactDir,
  resolveStorageProvider,
} from './storage.ts';

function makeStorageProvider(name: string, publicBaseUrl = 'file://test'): StorageProvider {
  return {
    name,
    put: () => Promise.reject(new Error('unused')),
    list: () => Promise.resolve([]),
    url: () => Promise.reject(new Error('unused')),
    putObject: () => Promise.reject(new Error('unused')),
    getObject: () => Promise.resolve(null),
    publicUrl: (objectKey) => `${publicBaseUrl.replace(/\/$/, '')}/${objectKey.replace(/^\//, '')}`,
  };
}

function missingSupabaseUrl(name: string, providerOptions: StorageProviderOptions): boolean {
  if (name != 'supabase') {
    return false;
  }

  return providerOptions.storageConfig?.supabaseUrl == null;
}

function makeStorageResolver(name: string) {
  return {
    name,
    resolveStorageProvider: (providerOptions: StorageProviderOptions) => {
      const isMissingSupabaseUrl = missingSupabaseUrl(name, providerOptions);

      if (isMissingSupabaseUrl) {
        return Promise.reject(new Error('supabaseUrl is required'));
      }

      let publicBaseUrl = 'file://test';

      if (providerOptions.storageConfig != null) {
        publicBaseUrl = providerOptions.storageConfig.publicBaseUrl;
      }

      const storageProvider = makeStorageProvider(name, publicBaseUrl);
      return Promise.resolve(storageProvider);
    },
  };
}

beforeAll(() => {
  const storageResolver = makeStorageResolver('local');
  registerStorageProviderResolver(storageResolver);
  registerStorageProviderResolver(makeStorageResolver('s3'));
  registerStorageProviderResolver(makeStorageResolver('supabase'));
  const storageProvider = makeStorageProvider('local');
  registerStorageProvider(storageProvider);
});

function configWith(storage: string, storageConfig?: StorageConfig): LaunchConfig {
  const baseConfig: LaunchConfig = {
    profiles: { production: { name: 'production' } },
    credentials: 'local',
    storage,
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };

  if (storageConfig == null) {
    return baseConfig;
  }

  return { ...baseConfig, storageConfig };
}

const r2Config: StorageConfig = {
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  bucket: 'builds',
  publicBaseUrl: 'https://cdn.example.com/',
};

describe('resolveStorageProvider', () => {
  it('returns the local provider for `local`', async () => {
    const storageProvider = await resolveStorageProvider(configWith('local'));
    expect(storageProvider.name).toBe('local');
  });

  it('builds the s3 provider from storageConfig', async () => {
    const storageProvider = await resolveStorageProvider(configWith('s3', r2Config));
    expect(storageProvider.name).toBe('s3');
  });

  it('builds the supabase provider when supabaseUrl is present', async () => {
    const storageProvider = await resolveStorageProvider(
      configWith('supabase', {
        bucket: 'builds',
        publicBaseUrl: 'https://x.supabase.co/p',
        supabaseUrl: 'https://x.supabase.co',
      }),
    );
    expect(storageProvider.name).toBe('supabase');
  });

  it('fails clearly when a cloud provider has no storageConfig block', async () => {
    const storageProvider = resolveStorageProvider(configWith('s3'));
    await expect(storageProvider).rejects.toThrow(/needs a storageConfig block/i);
  });

  it('fails when supabase is selected without supabaseUrl', async () => {
    const storageProvider = resolveStorageProvider(configWith('supabase', r2Config));
    await expect(storageProvider).rejects.toThrow(/supabaseUrl/);
  });

  it('resolves a cloud provider the registry cannot - the submit-path regression guard', async () => {
    expect(() => getStorageProvider('s3')).toThrow();
    const storageProvider = await resolveStorageProvider(configWith('s3', r2Config));
    expect(storageProvider.name).toBe('s3');
  });
});

describe('resolveArtifactDir', () => {
  it('falls back to the global ~/.launch/artifacts when unset (back-compat)', () => {
    const artifactDir = resolveArtifactDir(undefined);
    expect(artifactDir).toBe(ARTIFACTS_DIR);
  });

  it('fails on an empty string - a likely config typo', () => {
    expect(() => resolveArtifactDir('   ')).toThrow(/must not be empty/);
  });

  it('expands a lone ~ to the home directory', () => {
    const artifactDir = resolveArtifactDir('~');
    const homeDirectory = homedir();
    expect(artifactDir).toBe(homeDirectory);
  });

  it('expands a leading ~/ against the home directory', () => {
    const artifactDir = resolveArtifactDir('~/builds/out');
    const homeDirectory = homedir();
    const absolutePath = resolve(homeDirectory, 'builds/out');
    expect(artifactDir).toBe(absolutePath);
  });

  it('keeps an absolute path as-is', () => {
    const artifactDir = resolveArtifactDir('/var/launch/artifacts');
    expect(artifactDir).toBe('/var/launch/artifacts');
  });

  it('resolves a relative path against the project root', () => {
    const artifactDir = resolveArtifactDir('./.launch/artifacts', '/repo');
    const absolutePath = resolve('/repo', '.launch/artifacts');
    expect(artifactDir).toBe(absolutePath);
  });
});

describe('isCloudStorage', () => {
  it('is false for local, true for cloud providers', () => {
    expect(isCloudStorage(configWith('local'))).toBe(false);
    expect(isCloudStorage(configWith('s3', r2Config))).toBe(true);
  });
});

describe('s3 publicUrl', () => {
  it('joins the public base URL and key with a single slash, ignoring stray slashes', async () => {
    const storageProvider = await resolveStorageProvider(configWith('s3', r2Config));
    expect(storageProvider.publicUrl('apps/hello/manifest.json')).toBe(
      'https://cdn.example.com/apps/hello/manifest.json',
    );
    expect(storageProvider.publicUrl('/leading')).toBe('https://cdn.example.com/leading');
  });
});

describe('ensureArtifactPresent', () => {
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

  it("passes when the artifact's binary is still on disk", async () => {
    const buildProgram = storedBuild();
    const artifactPresent = ensureArtifactPresent(buildProgram, 'Hello', 'android');
    await expect(artifactPresent).resolves.toBeUndefined();
  });

  it('fails when the artifact was pruned to reclaim disk', async () => {
    const buildProgram = storedBuild({ prunedAt: '2026-01-02T00:00:00.000Z' });
    const artifactPresent = ensureArtifactPresent(buildProgram, 'Hello', 'android');
    await expect(artifactPresent).rejects.toThrow(/rebuild before releasing/);
  });

  it('fails when the recorded binary is missing from disk', async () => {
    const buildProgram = storedBuild({ path: '/no/such/build.aab' });
    const artifactPresent = ensureArtifactPresent(buildProgram, 'Hello', 'android');
    await expect(artifactPresent).rejects.toThrow(/pruned to reclaim disk/);
  });
});
