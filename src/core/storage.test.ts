import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BuildArtifact, LaunchConfig, StorageConfig } from './types.js';
import {
  ensureArtifactPresent,
  isCloudStorage,
  resolveArtifactDir,
  resolveStorageProvider,
} from './storage.js';
import { getStorageProvider, registerStorageProvider } from './registry.js';
import { ARTIFACTS_DIR } from './paths.js';
import { localStorageProvider } from '../providers/storage/local.js';

/** A LaunchConfig with the given storage settings and otherwise-irrelevant defaults. */
function configWith(storage: string, storageConfig?: StorageConfig): LaunchConfig {
  return {
    profiles: { production: { name: 'production' } },
    credentials: 'local',
    storage,
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
    ...(storageConfig ? { storageConfig } : {}),
  };
}

const r2Config: StorageConfig = {
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  bucket: 'builds',
  publicBaseUrl: 'https://cdn.example.com/',
};

describe('resolveStorageProvider', () => {
  it('returns the registered local provider for `local`', () => {
    registerStorageProvider(localStorageProvider);
    expect(resolveStorageProvider(configWith('local')).name).toBe('local');
  });

  it('builds the s3 provider from storageConfig', () => {
    expect(resolveStorageProvider(configWith('s3', r2Config)).name).toBe('s3');
  });

  it('builds the supabase provider when supabaseUrl is present', () => {
    const provider = resolveStorageProvider(
      configWith('supabase', {
        bucket: 'builds',
        publicBaseUrl: 'https://x.supabase.co/p',
        supabaseUrl: 'https://x.supabase.co',
      }),
    );
    expect(provider.name).toBe('supabase');
  });

  it('throws a clear error when a cloud provider is named without a storageConfig block', () => {
    expect(() => resolveStorageProvider(configWith('s3'))).toThrow(/needs a `storageConfig` block/);
  });

  it('throws when supabase is selected without supabaseUrl', () => {
    expect(() => resolveStorageProvider(configWith('supabase', r2Config))).toThrow(/supabaseUrl/);
  });

  it('resolves a cloud provider the registry cannot — the submit-path regression guard', () => {
    // The release-train and `launch release` submit/store paths once looked storage up via the registry
    // (`getStorageProvider(config.storage)`), where only `local` is ever registered — so `s3`/`supabase`
    // threw "Unknown storage provider". The resolver must build a cloud backend from `storageConfig`
    // instead; this pins the contrast so a regression back to the registry would fail here.
    expect(() => getStorageProvider('s3')).toThrow();
    expect(resolveStorageProvider(configWith('s3', r2Config)).name).toBe('s3');
  });
});

describe('resolveArtifactDir', () => {
  it('falls back to the global ~/.launch/artifacts when unset (back-compat)', () => {
    expect(resolveArtifactDir(undefined)).toBe(ARTIFACTS_DIR);
  });

  it('throws on an empty string — a likely config typo', () => {
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
  it('joins the public base URL and key with a single slash, ignoring stray slashes', () => {
    const provider = resolveStorageProvider(configWith('s3', r2Config));
    expect(provider.publicUrl('apps/hello/manifest.json')).toBe(
      'https://cdn.example.com/apps/hello/manifest.json',
    );
    expect(provider.publicUrl('/leading')).toBe('https://cdn.example.com/leading');
  });
});

describe('ensureArtifactPresent', () => {
  /** A stored artifact whose binary is this very test file — a path guaranteed to exist on disk. */
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

  it("passes when the artifact's binary is still on disk", () => {
    expect(() => {
      ensureArtifactPresent(storedBuild(), 'Hello', 'android');
    }).not.toThrow();
  });

  it('throws when the artifact was pruned to reclaim disk', () => {
    expect(() => {
      ensureArtifactPresent(
        storedBuild({ prunedAt: '2026-01-02T00:00:00.000Z' }),
        'Hello',
        'android',
      );
    }).toThrow(/rebuild before releasing/);
  });

  it('throws when the recorded binary is missing from disk', () => {
    expect(() => {
      ensureArtifactPresent(storedBuild({ path: '/no/such/build.aab' }), 'Hello', 'android');
    }).toThrow(/pruned to reclaim disk/);
  });
});
