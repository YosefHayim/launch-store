import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  getStorageProvider,
  registerStorageProvider,
  registerStorageProviderResolver,
} from '../services/registry.js';
import { ARTIFACTS_DIR, type LaunchPathsService, makeLaunchPathsTest } from '../services/paths.js';
import type { BuildArtifact } from '../types/artifacts.js';
import type { LaunchConfig, StorageConfig } from '../types/config.js';
import type { StorageProvider, StorageProviderOptions } from '../types/providers.js';
import {
  ensureArtifactPresent,
  isCloudStorage,
  resolveArtifactDir,
  resolveStorageProvider,
} from './storage.js';

const makeStorageProvider = (name: string, publicBaseUrl = 'file://test'): StorageProvider => ({
  name,
  put: () => Effect.fail(new Error('unused')),
  list: () => Effect.succeed([]),
  url: () => Effect.fail(new Error('unused')),
  putObject: () => Effect.fail(new Error('unused')),
  getObject: () => Effect.succeed(null),
  publicUrl: (objectKey) => `${publicBaseUrl.replace(/\/$/, '')}/${objectKey.replace(/^\//, '')}`,
});

const makeStorageResolver = (name: string) => ({
  name,
  resolveStorageProvider: (providerOptions: StorageProviderOptions) => {
    if (name === 'supabase' && providerOptions.storageConfig?.supabaseUrl === undefined) {
      return Effect.fail(new Error('supabaseUrl is required'));
    }
    let publicBaseUrl = 'file://test';
    if (providerOptions.storageConfig !== undefined) {
      publicBaseUrl = providerOptions.storageConfig.publicBaseUrl;
    }
    return Effect.succeed(makeStorageProvider(name, publicBaseUrl));
  },
});

const runStorageEffect = <Success, Failure>(
  storageEffect: Effect.Effect<Success, Failure, LaunchPathsService | NodeContext.NodeContext>,
) =>
  Effect.runPromise(
    storageEffect.pipe(
      Effect.provide(makeLaunchPathsTest(homedir(), '/repo')),
      Effect.provide(NodeContext.layer),
    ),
  );

beforeAll(() => {
  registerStorageProviderResolver(makeStorageResolver('local'));
  registerStorageProviderResolver(makeStorageResolver('s3'));
  registerStorageProviderResolver(makeStorageResolver('supabase'));
  registerStorageProvider(makeStorageProvider('local'));
});
/** A LaunchConfig with the given storage settings and otherwise-irrelevant defaults. */
const configWith = (storage: string, storageConfig?: StorageConfig): LaunchConfig => {
  const baseConfig: LaunchConfig = {
    profiles: { production: { name: 'production' } },
    credentials: 'local',
    storage,
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
  };
  if (storageConfig === undefined) return baseConfig;
  return { ...baseConfig, storageConfig };
};
const r2Config: StorageConfig = {
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  bucket: 'builds',
  publicBaseUrl: 'https://cdn.example.com/',
};
describe('resolveStorageProvider', () => {
  it('returns the local provider for `local`', async () => {
    const storageProvider = await runStorageEffect(resolveStorageProvider(configWith('local')));
    expect(storageProvider.name).toBe('local');
  });
  it('builds the s3 provider from storageConfig', async () => {
    const storageProvider = await runStorageEffect(
      resolveStorageProvider(configWith('s3', r2Config)),
    );
    expect(storageProvider.name).toBe('s3');
  });
  it('builds the supabase provider when supabaseUrl is present', async () => {
    const storageProvider = await runStorageEffect(
      resolveStorageProvider(
        configWith('supabase', {
          bucket: 'builds',
          publicBaseUrl: 'https://x.supabase.co/p',
          supabaseUrl: 'https://x.supabase.co',
        }),
      ),
    );
    expect(storageProvider.name).toBe('supabase');
  });
  it('fails clearly when a cloud provider has no storageConfig block', async () => {
    await expect(runStorageEffect(resolveStorageProvider(configWith('s3')))).rejects.toThrow(
      /needs a storageConfig block/i,
    );
  });
  it('fails when supabase is selected without supabaseUrl', async () => {
    await expect(
      runStorageEffect(resolveStorageProvider(configWith('supabase', r2Config))),
    ).rejects.toThrow(/supabaseUrl/);
  });
  it('resolves a cloud provider the registry cannot - the submit-path regression guard', async () => {
    // The release-train and `launch release` submit/store paths once looked storage up via the registry
    // (`getStorageProvider(config.storage)`), where only `local` is ever registered - so `s3`/`supabase`
    // threw "Unknown storage provider". The resolver must build a cloud backend from `storageConfig`
    // instead; this pins the contrast so a regression back to the registry would fail here.
    await expect(Effect.runPromise(getStorageProvider('s3'))).rejects.toThrow();
    const storageProvider = await runStorageEffect(
      resolveStorageProvider(configWith('s3', r2Config)),
    );
    expect(storageProvider.name).toBe('s3');
  });
});
describe('resolveArtifactDir', () => {
  it('falls back to the global ~/.launch/artifacts when unset (back-compat)', async () => {
    await expect(runStorageEffect(resolveArtifactDir(undefined))).resolves.toBe(ARTIFACTS_DIR);
  });
  it('fails on an empty string - a likely config typo', async () => {
    await expect(runStorageEffect(resolveArtifactDir('   '))).rejects.toThrow(/must not be empty/);
  });
  it('expands a lone ~ to the home directory', async () => {
    await expect(runStorageEffect(resolveArtifactDir('~'))).resolves.toBe(homedir());
  });
  it('expands a leading ~/ against the home directory', async () => {
    await expect(runStorageEffect(resolveArtifactDir('~/builds/out'))).resolves.toBe(
      resolve(homedir(), 'builds/out'),
    );
  });
  it('keeps an absolute path as-is', async () => {
    await expect(runStorageEffect(resolveArtifactDir('/var/launch/artifacts'))).resolves.toBe(
      '/var/launch/artifacts',
    );
  });
  it('resolves a relative path against the project root', async () => {
    await expect(
      runStorageEffect(resolveArtifactDir('./.launch/artifacts', '/repo')),
    ).resolves.toBe(resolve('/repo', '.launch/artifacts'));
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
    const storageProvider = await runStorageEffect(
      resolveStorageProvider(configWith('s3', r2Config)),
    );
    expect(storageProvider.publicUrl('apps/hello/manifest.json')).toBe(
      'https://cdn.example.com/apps/hello/manifest.json',
    );
    expect(storageProvider.publicUrl('/leading')).toBe('https://cdn.example.com/leading');
  });
});
describe('ensureArtifactPresent', () => {
  /** A stored artifact whose binary is this very test file - a path guaranteed to exist on disk. */
  const storedBuild = (overrides: Partial<BuildArtifact> = {}): BuildArtifact => {
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
  };
  it("passes when the artifact's binary is still on disk", async () => {
    await expect(
      runStorageEffect(ensureArtifactPresent(storedBuild(), 'Hello', 'android')),
    ).resolves.toBeUndefined();
  });
  it('fails when the artifact was pruned to reclaim disk', async () => {
    await expect(
      runStorageEffect(
        ensureArtifactPresent(
          storedBuild({ prunedAt: '2026-01-02T00:00:00.000Z' }),
          'Hello',
          'android',
        ),
      ),
    ).rejects.toThrow(/rebuild before releasing/);
  });
  it('fails when the recorded binary is missing from disk', async () => {
    await expect(
      runStorageEffect(
        ensureArtifactPresent(storedBuild({ path: '/no/such/build.aab' }), 'Hello', 'android'),
      ),
    ).rejects.toThrow(/pruned to reclaim disk/);
  });
});
