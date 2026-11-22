import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { ARTIFACTS_DIR } from '../services/platform/paths.js';
import {
  getStorageProvider,
  registerStorageProvider,
  registerStorageProviderResolver,
} from '../services/providerSupport/registry.js';
import type { BuildArtifact } from '../types/artifacts.js';
import type { LaunchConfig, StorageConfig } from '../types/config.js';
import type { StorageProvider, StorageProviderOptions } from '../types/providers.js';
import {
  ensureArtifactPresent,
  isCloudStorage,
  resolveArtifactDir,
  resolveStorageProvider,
} from './storage.js';

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

      return Promise.resolve(makeStorageProvider(name, publicBaseUrl));
    },
  };
}

beforeAll(() => {
  registerStorageProviderResolver(makeStorageResolver('local'));
  registerStorageProviderResolver(makeStorageResolver('s3'));
  registerStorageProviderResolver(makeStorageResolver('supabase'));
  registerStorageProvider(makeStorageProvider('local'));
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
    await expect(resolveStorageProvider(configWith('s3'))).rejects.toThrow(
      /needs a storageConfig block/i,
    );
  });

  it('fails when supabase is selected without supabaseUrl', async () => {
    await expect(resolveStorageProvider(configWith('supabase', r2Config))).rejects.toThrow(
      /supabaseUrl/,
    );
  });

  it('resolves a cloud provider the registry cannot - the submit-path regression guard', async () => {
    expect(() => getStorageProvider('s3')).toThrow();
    const storageProvider = await resolveStorageProvider(configWith('s3', r2Config));
    expect(storageProvider.name).toBe('s3');
  });
});

describe('resolveArtifactDir', () => {
  it('falls back to the global ~/.launch/artifacts when unset (back-compat)', () => {
    expect(resolveArtifactDir(undefined)).toBe(ARTIFACTS_DIR);
  });

  it('fails on an empty string - a likely config typo', () => {
    expect(() => resolveArtifactDir('   ')).toThrow(/must not be empty/);
  });

  it('expands a lone ~ to the home directory', () => {
    expect(resolveArtifactDir('~')).toBe(homedir());
  });

  it('expands a leading ~/ against the home directory', () => {
    expect(resolveArtifactDir('~/builds/out')).toBe(resolve(homedir(), 'builds/out'));
  });

  it('keeps an absolute path as-is', () => {
    expect(resolveArtifactDir('/var/launch/artifacts')).toBe('/var/launch/artifacts');
  });

  it('resolves a relative path against the project root', () => {
    expect(resolveArtifactDir('./.launch/artifacts', '/repo')).toBe(
      resolve('/repo', '.launch/artifacts'),
    );
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
    await expect(ensureArtifactPresent(storedBuild(), 'Hello', 'android')).resolves.toBeUndefined();
  });

  it('fails when the artifact was pruned to reclaim disk', async () => {
    await expect(
      ensureArtifactPresent(
        storedBuild({ prunedAt: '2026-01-02T00:00:00.000Z' }),
        'Hello',
        'android',
      ),
    ).rejects.toThrow(/rebuild before releasing/);
  });

  it('fails when the recorded binary is missing from disk', async () => {
    await expect(
      ensureArtifactPresent(storedBuild({ path: '/no/such/build.aab' }), 'Hello', 'android'),
    ).rejects.toThrow(/pruned to reclaim disk/);
  });
});
