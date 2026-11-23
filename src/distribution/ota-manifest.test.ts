import { describe, expect, it } from 'vitest';
import {
  assembleManifest,
  assembleRollbackDirective,
  contentTypeFor,
  historyIndexKey,
  historySnapshotKey,
  manifestKey,
  manifestSignatureKey,
  rollbackDirectiveKey,
  updatesAppConfigSnippet,
  updatesWorkerScript,
} from './ota-manifest.ts';
function describePieceTypeFor() {
  function mapsKnownExtensionsAndDefaultsUnknownOnesToOctetStream() {
    const typeFor = contentTypeFor('_expo/static/js/ios/index-abc.hbc');

    expect(typeFor).toBe('application/javascript');
    expect(contentTypeFor('assets/logo.png')).toBe('image/png');
    expect(contentTypeFor('fonts/Inter.ttf')).toBe('font/ttf');
    expect(contentTypeFor('weird.xyz')).toBe('application/octet-stream');
  }

  it(
    'maps known extensions and defaults unknown ones to octet-stream',
    mapsKnownExtensionsAndDefaultsUnknownOnesToOctetStream,
  );
}

describe('contentTypeFor', describePieceTypeFor);
function describeAssembleManifest() {
  function producesAProtocolV0ManifestWithEmptyMetadataExtra() {
    const manifest = assembleManifest({
      id: 'uuid-1',
      createdAt: '2026-06-14T00:00:00.000Z',
      runtimeVersion: '1.0.0',
      launchAsset: {
        key: 'bundle',
        contentType: 'application/javascript',
        url: 'https://cdn/x.hbc',
      },
      assets: [
        { key: 'logo', contentType: 'image/png', url: 'https://cdn/logo', fileExtension: '.png' },
      ],
    });

    expect(manifest).toMatchObject({
      id: 'uuid-1',
      runtimeVersion: '1.0.0',
      launchAsset: { url: 'https://cdn/x.hbc' },
      metadata: {},
      extra: {},
    });
    expect(manifest.assets[0]?.fileExtension).toBe('.png');
  }

  it(
    'produces a protocol-v0 manifest with empty metadata/extra',
    producesAProtocolV0ManifestWithEmptyMetadataExtra,
  );
}

describe('assembleManifest', describeAssembleManifest);
function describeManifestKey() {
  function keysAManifestByChannelPlatformAndRuntimeVersion() {
    expect(manifestKey('production', 'ios', '1.0.0')).toBe(
      'updates/production/ios/1.0.0/manifest.json',
    );
    expect(manifestSignatureKey('production', 'ios', '1.0.0')).toBe(
      'updates/production/ios/1.0.0/manifest.sig',
    );
  }

  it(
    'keys a manifest by channel, platform, and runtime version',
    keysAManifestByChannelPlatformAndRuntimeVersion,
  );
}

describe('manifestKey', describeManifestKey);
function describeHistoryRollbackKeys() {
  function keysTheIndexPerChannelPlatformAndSnapshotsDirectivesUnderTheRuntimeVersion() {
    expect(historyIndexKey('production', 'android')).toBe(
      'updates/production/android/history.json',
    );
    expect(historySnapshotKey('production', 'ios', '1.0.0', 'abc')).toBe(
      'updates/production/ios/1.0.0/history/abc.json',
    );
    expect(rollbackDirectiveKey('production', 'ios', '1.0.0')).toBe(
      'updates/production/ios/1.0.0/rollback.json',
    );
  }

  it(
    'keys the index per channel+platform and snapshots/directives under the runtime version',
    keysTheIndexPerChannelPlatformAndSnapshotsDirectivesUnderTheRuntimeVersion,
  );
}

describe('history + rollback keys', describeHistoryRollbackKeys);
function describeAssembleRollbackDirective() {
  function buildsARollBackToEmbeddedDirectiveCommittedAtTheGivenTime() {
    expect(assembleRollbackDirective('2026-06-14T00:00:00.000Z')).toEqual({
      type: 'rollBackToEmbedded',
      parameters: { commitTime: '2026-06-14T00:00:00.000Z' },
    });
  }

  it(
    'builds a rollBackToEmbedded directive committed at the given time',
    buildsARollBackToEmbeddedDirectiveCommittedAtTheGivenTime,
  );
}

describe('assembleRollbackDirective', describeAssembleRollbackDirective);
function describeUpdatesWorkerScript() {
  function readsTheExpoHeadersAndRoutesToTheStaticManifestUnderThePublicBase() {
    const script = updatesWorkerScript('https://cdn.example.com/');

    expect(script).toContain('expo-runtime-version');
    expect(script).toContain('expo-channel-name');
    expect(script).toContain('"https://cdn.example.com"');
    expect(script).toContain('expo-protocol-version');
    expect(script).toContain('manifest.sig');
  }

  it(
    'reads the expo headers and routes to the static manifest under the public base',
    readsTheExpoHeadersAndRoutesToTheStaticManifestUnderThePublicBase,
  );

  function emitsAProtocolV1MultipartPieceWithARollbackDirectivePart() {
    const script = updatesWorkerScript('https://cdn.example.com');

    expect(script).toContain('multipart/mixed');
    expect(script).toContain("'expo-protocol-version': '1'");
    expect(script).toContain('rollback.json');
    expect(script).toContain("part('directive'");
    expect(script).toContain("part('manifest'");
  }

  it(
    'emits a protocol-v1 multipart response with a rollback directive part',
    emitsAProtocolV1MultipartPieceWithARollbackDirectivePart,
  );
}

describe('updatesWorkerScript', describeUpdatesWorkerScript);
function describeUpdatesAppPieceSnippet() {
  function includesTheCodeSigningBlockOnlyWhenSigned() {
    const signed = updatesAppConfigSnippet({
      updateUrl: 'https://w',
      runtimeVersion: '1.0.0',
      signed: true,
    });

    expect(signed).toContain('codeSigningCertificate');
    expect(signed).toContain('rsa-v1_5-sha256');

    const unsigned = updatesAppConfigSnippet({
      updateUrl: 'https://w',
      runtimeVersion: '1.0.0',
      signed: false,
    });

    expect(unsigned).not.toContain('codeSigningCertificate');
  }

  it('includes the code-signing block only when signed', includesTheCodeSigningBlockOnlyWhenSigned);
}

describe('updatesAppConfigSnippet', describeUpdatesAppPieceSnippet);
