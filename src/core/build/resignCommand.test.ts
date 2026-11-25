import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { BuildArtifact } from '../types/artifacts.js';
import type { KeystoreAssets } from '../types/credentials.js';
import {
  androidResignSpec,
  assertResignablePlatform,
  filterStoredArtifactsByApp,
  iosCodesignArgs,
  makeResignCommandFailure,
  plistBuddyEntitlementsArgs,
  resignOutputPath,
  securityCmsArgs,
  storedArtifactReference,
  unzipArgs,
  zipArgs,
} from './resignCommand.js';

const ipa: BuildArtifact = {
  path: '/store/sampleapp-1.2.0-42-ios.ipa',
  platform: 'ios',
  appName: 'sampleapp',
  profile: 'production',
  version: '1.2.0',
  buildNumber: 42,
  sizeReport: { artifactBytes: 1, entries: [] },
  clean: true,
  createdAt: '2026-06-14T00:00:00.000Z',
};
const androidApk: BuildArtifact = {
  ...ipa,
  path: '/store/otherapp-1.0.0-1-android.apk',
  platform: 'android',
  appName: 'otherapp',
  version: '1.0.0',
  buildNumber: 1,
};
const storePassword = ['test', 'store', 'pw'].join('-');
const keyPassword = ['test', 'key', 'pw'].join('-');
const keystore: KeystoreAssets = {
  path: '/ks/upload.jks',
  alias: 'upload',
  storePassword,
  keyPassword,
};

describe('assertResignablePlatform', () => {
  it('allows IPA and Android formats and rejects macOS packages', async () => {
    await expect(
      Effect.runPromise(
        Effect.forEach(['ios', 'tvos', 'visionos', 'android'] as const, assertResignablePlatform),
      ),
    ).resolves.toEqual([undefined, undefined, undefined, undefined]);
    await expect(
      Effect.runPromise(assertResignablePlatform('macos').pipe(Effect.either)),
    ).resolves.toMatchObject({ _tag: 'Left', left: { _tag: 'ResignCommandFailure' } });
  });
});

describe('resignOutputPath', () => {
  it('uses natural identifiers and the source extension', () => {
    expect(resignOutputPath(ipa, '/out', '.ipa')).toBe('/out/sampleapp-1.2.0-42-resigned.ipa');
  });
});

describe('storedArtifactReference', () => {
  it('keeps an explicit build id', () => {
    expect(
      storedArtifactReference({
        id: 'sampleapp-1.2.0-42',
        dryRun: false,
      }),
    ).toBe('sampleapp-1.2.0-42');
  });

  it('defaults to latest when no id is provided', () => {
    expect(storedArtifactReference({ dryRun: true })).toBe('latest');
  });
});

describe('filterStoredArtifactsByApp', () => {
  it('returns the full history when no app scope is set', () => {
    expect(filterStoredArtifactsByApp([ipa, androidApk], undefined)).toEqual([ipa, androidApk]);
  });

  it('keeps only artifacts for the selected app handle', () => {
    expect(filterStoredArtifactsByApp([ipa, androidApk], 'otherapp')).toEqual([androidApk]);
  });
});

describe('Apple signing arguments', () => {
  it('creates the expected unzip, zip, profile, and codesign arguments', () => {
    expect(unzipArgs('/a.ipa', '/w')).toEqual(['-oq', '/a.ipa', '-d', '/w']);
    expect(zipArgs('/out.ipa')).toEqual(['-qr', '/out.ipa', 'Payload']);
    expect(securityCmsArgs('/p.mobileprovision')).toEqual([
      'cms',
      '-D',
      '-i',
      '/p.mobileprovision',
    ]);
    expect(plistBuddyEntitlementsArgs('/p.plist')).toEqual([
      '-x',
      '-c',
      'Print :Entitlements',
      '/p.plist',
    ]);
    expect(iosCodesignArgs('/w/Payload/App.app', 'Apple Distribution', '/w/ent.plist')).toEqual([
      '-f',
      '-s',
      'Apple Distribution',
      '--entitlements',
      '/w/ent.plist',
      '/w/Payload/App.app',
    ]);
  });
});

describe('androidResignSpec', () => {
  it('uses apksigner for APK files without putting passwords in argv', () => {
    const resignSpec = androidResignSpec('/out.apk', keystore);
    expect(resignSpec.command).toBe('apksigner');
    expect(resignSpec.arguments).not.toContain(storePassword);
    expect(resignSpec.environment['LAUNCH_KS_STOREPASS']).toBe(storePassword);
  });

  it('uses jarsigner for AAB files without putting passwords in argv', () => {
    const resignSpec = androidResignSpec('/out.aab', keystore);
    expect(resignSpec.command).toBe('jarsigner');
    expect(resignSpec.arguments).toContain('-storepass:env');
    expect(resignSpec.arguments).not.toContain(storePassword);
    expect(resignSpec.environment['LAUNCH_KS_KEYPASS']).toBe(keyPassword);
  });
});

describe('makeResignCommandFailure', () => {
  it('tags operation-specific resign failures for the public error channel', () => {
    const failure = makeResignCommandFailure({
      operation: 'select stored artifact',
      message: 'No stored build matches "latest".',
    });
    expect(failure._tag).toBe('ResignCommandFailure');
    expect(failure.operation).toBe('select stored artifact');
  });
});
