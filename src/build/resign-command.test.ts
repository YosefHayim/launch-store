import { describe, expect, it } from 'vitest';
import type { BuildArtifact } from '../types/artifacts.ts';
import type { KeystoreAssets } from '../types/credentials.ts';
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
} from './resign-command.ts';

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
function describeAssertResignablePlatform() {
  function allowsIPAAndAndroidFormatsAndRejectsMacOSPackages() {
    for (const platform of ['ios', 'tvos', 'visionos', 'android'] as const) {
      function callAssertResignablePlatform() {
        return assertResignablePlatform(platform);
      }

      expect(callAssertResignablePlatform).not.toThrow();
    }

    try {
      assertResignablePlatform('macos');
      throw new Error('expected macos to fail');
    } catch (error) {
      expect(error).toMatchObject({ _tag: 'ResignCommandFailure' });
    }
  }

  it(
    'allows IPA and Android formats and rejects macOS packages',
    allowsIPAAndAndroidFormatsAndRejectsMacOSPackages,
  );
}

describe('assertResignablePlatform', describeAssertResignablePlatform);
function describeResignPiecePath() {
  function usesNaturalIdentifiersAndThePieceExtension() {
    const resignPath = resignOutputPath(ipa, '/out', '.ipa');
    expect(resignPath).toBe('/out/sampleapp-1.2.0-42-resigned.ipa');
  }

  it(
    'uses natural identifiers and the source extension',
    usesNaturalIdentifiersAndThePieceExtension,
  );
}

describe('resignOutputPath', describeResignPiecePath);
function describeStoredArtifactReference() {
  function keepsAnExplicitBuildId() {
    expect(
      storedArtifactReference({
        id: 'sampleapp-1.2.0-42',
        dryRun: false,
      }),
    ).toBe('sampleapp-1.2.0-42');
  }

  it('keeps an explicit build id', keepsAnExplicitBuildId);
  function defaultsToLatestWhenNoIdIsProvided() {
    expect(storedArtifactReference({ dryRun: true })).toBe('latest');
  }

  it('defaults to latest when no id is provided', defaultsToLatestWhenNoIdIsProvided);
}

describe('storedArtifactReference', describeStoredArtifactReference);
function describeFilterStoredArtifactsByApp() {
  function returnsTheFullHistoryWhenNoAppScopeIsSet() {
    expect(filterStoredArtifactsByApp([ipa, androidApk], undefined)).toEqual([ipa, androidApk]);
  }

  it('returns the full history when no app scope is set', returnsTheFullHistoryWhenNoAppScopeIsSet);
  function keepsOnlyArtifactsForTheSelectedAppHandle() {
    expect(filterStoredArtifactsByApp([ipa, androidApk], 'otherapp')).toEqual([androidApk]);
  }

  it('keeps only artifacts for the selected app handle', keepsOnlyArtifactsForTheSelectedAppHandle);
}

describe('filterStoredArtifactsByApp', describeFilterStoredArtifactsByApp);
function describeAppleSigningArguments() {
  function createsTheExpectedUnzipZipProfileAndCodesignArguments() {
    const unzip = unzipArgs('/a.ipa', '/w');
    expect(unzip).toEqual(['-oq', '/a.ipa', '-d', '/w']);
    const zip = zipArgs('/out.ipa');
    expect(zip).toEqual(['-qr', '/out.ipa', 'Payload']);
    const securityCms = securityCmsArgs('/p.mobileprovision');
    expect(securityCms).toEqual(['cms', '-D', '-i', '/p.mobileprovision']);
    const plistBuddyEntitlements = plistBuddyEntitlementsArgs('/p.plist');
    expect(plistBuddyEntitlements).toEqual(['-x', '-c', 'Print :Entitlements', '/p.plist']);
    const iosCodesign = iosCodesignArgs('/w/Payload/App.app', 'Apple Distribution', '/w/ent.plist');
    expect(iosCodesign).toEqual([
      '-f',
      '-s',
      'Apple Distribution',
      '--entitlements',
      '/w/ent.plist',
      '/w/Payload/App.app',
    ]);
  }

  it(
    'creates the expected unzip, zip, profile, and codesign arguments',
    createsTheExpectedUnzipZipProfileAndCodesignArguments,
  );
}

describe('Apple signing arguments', describeAppleSigningArguments);
function describeAndroidResignSpec() {
  function usesApksignerForAPKFilesWithoutPuttingPasswordsInArgv() {
    const resignSpec = androidResignSpec('/out.apk', keystore);
    expect(resignSpec.command).toBe('apksigner');
    expect(resignSpec.arguments).not.toContain(storePassword);
    expect(resignSpec.environment['LAUNCH_KS_STOREPASS']).toBe(storePassword);
  }

  it(
    'uses apksigner for APK files without putting passwords in argv',
    usesApksignerForAPKFilesWithoutPuttingPasswordsInArgv,
  );
  function usesJarsignerForAABFilesWithoutPuttingPasswordsInArgv() {
    const resignSpec = androidResignSpec('/out.aab', keystore);
    expect(resignSpec.command).toBe('jarsigner');
    expect(resignSpec.arguments).toContain('-storepass:env');
    expect(resignSpec.arguments).not.toContain(storePassword);
    expect(resignSpec.environment['LAUNCH_KS_KEYPASS']).toBe(keyPassword);
  }

  it(
    'uses jarsigner for AAB files without putting passwords in argv',
    usesJarsignerForAABFilesWithoutPuttingPasswordsInArgv,
  );
}

describe('androidResignSpec', describeAndroidResignSpec);
function describeMakeResignCommandFailure() {
  function tagsOperationSpecificResignFailuresForThePublicErrorChannel() {
    const failure = makeResignCommandFailure({
      operation: 'select stored artifact',
      message: 'No stored build matches "latest".',
    });
    expect(failure._tag).toBe('ResignCommandFailure');
    expect(failure.operation).toBe('select stored artifact');
  }

  it(
    'tags operation-specific resign failures for the public error channel',
    tagsOperationSpecificResignFailuresForThePublicErrorChannel,
  );
}

describe('makeResignCommandFailure', describeMakeResignCommandFailure);
