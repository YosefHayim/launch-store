import { describe, expect, it } from 'vitest';
import type { ResolvedBuildContext } from '@/types/config.js';
import type { BuildCredentials } from '@/types/credentials.js';
import { gradleBuildArguments, makeGradleBuildEngine, parseBundletoolSize } from './gradle.ts';
function describeGradleBuildArgumentsSignedReleaseBuild() {
  const keystore = {
    path: '/keys/upload.jks',
    alias: 'upload',
    storePassword: 'store-secret',
    keyPassword: 'key-secret',
  };

  function reusesCachedTaskOutputsAndSignsWithTheUploadKey() {
    expect(gradleBuildArguments(':app:bundleRelease', false, keystore)).toEqual([
      ':app:bundleRelease',
      '--build-cache',
      '-Pandroid.injected.signing.store.file=/keys/upload.jks',
      '-Pandroid.injected.signing.key.alias=upload',
    ]);
  }

  it(
    'reuses cached task outputs and signs with the upload key',
    reusesCachedTaskOutputsAndSignsWithTheUploadKey,
  );

  function prependsTheCleanTaskForAFromScratchBuild() {
    const cleanArguments = gradleBuildArguments(':app:assembleRelease', true, keystore);

    expect(cleanArguments.slice(0, 3)).toEqual([
      ':app:clean',
      ':app:assembleRelease',
      '--build-cache',
    ]);
  }

  it('prepends the clean task for a from-scratch build', prependsTheCleanTaskForAFromScratchBuild);
}

describe(
  'gradleBuildArguments - signed release build',
  describeGradleBuildArgumentsSignedReleaseBuild,
);
function describeParseBundletoolSizeHonestWorstCaseDownloadFromGetSizeTotal() {
  function readsMINMAXFromASinglePieceTotal() {
    const bundletoolSize = parseBundletoolSize('MIN,MAX\n1048576,2097152');

    expect(bundletoolSize).toEqual({
      minBytes: 1048576,
      maxBytes: 2097152,
    });
  }

  it('reads MIN/MAX from a single-row total', readsMINMAXFromASinglePieceTotal);

  function takesTheLargestMAXAndSmallestMINAcrossDeviceDimensions() {
    const csv = [
      'SDK,ABI,SCREEN_DENSITY,LANGUAGE,MIN,MAX',
      '21,armeabi-v7a,MDPI,en,3000000,4000000',
      '21,arm64-v8a,XXHDPI,en,3500000,6000000',
      '29,arm64-v8a,XXHDPI,en,3200000,5500000',
    ].join('\n');
    const bundletoolSize = parseBundletoolSize(csv);

    expect(bundletoolSize).toEqual({ minBytes: 3000000, maxBytes: 6000000 });
  }

  it(
    'takes the largest MAX and smallest MIN across device dimensions',
    takesTheLargestMAXAndSmallestMINAcrossDeviceDimensions,
  );

  function degradesToZerosOnUnrecognizedPieceRatherThanThrowing() {
    const bundletoolSize = parseBundletoolSize('totally unrelated');
    expect(bundletoolSize).toEqual({ minBytes: 0, maxBytes: 0 });
    expect(parseBundletoolSize('')).toEqual({ minBytes: 0, maxBytes: 0 });
  }

  it(
    'degrades to zeros on unrecognized output rather than throwing',
    degradesToZerosOnUnrecognizedPieceRatherThanThrowing,
  );
}

describe(
  'parseBundletoolSize - honest worst-case download from get-size total',
  describeParseBundletoolSizeHonestWorstCaseDownloadFromGetSizeTotal,
);
function describeGradleBuildEngineDryRunRehearsesWithoutBuildingOrSigning() {
  const buildContext = {
    platform: 'android',
    app: {
      name: 'demo',
      dir: '/repo',
      configPath: '/repo/app.json',
      packageName: 'com.example.demo',
    },
    profile: { name: 'production' },
    env: {},
    explain: false,
    dryRun: true,
    forceClean: false,
  } satisfies ResolvedBuildContext;
  const buildCredentials: BuildCredentials = { platform: 'android', serviceAccountJson: '' };

  async function returnsAZeroByteReportAndNeverTouchesTheKeystore() {
    const buildEngine = makeGradleBuildEngine();
    const builtArtifact = await buildEngine.buildArtifact(buildContext, buildCredentials);
    expect(builtArtifact.artifactPath).toBe('(dry-run, not built)');
    expect(builtArtifact.sizeReport).toEqual({ artifactBytes: 0, entries: [] });
  }

  it(
    'returns a zero-byte report and never touches the keystore',
    returnsAZeroByteReportAndNeverTouchesTheKeystore,
  );

  async function rejectsIOSCredentialsWrongPlatformOutsideDryRun() {
    const realBuildContext = { ...buildContext, dryRun: false };
    const buildEngine = makeGradleBuildEngine();

    await expect(
      buildEngine.buildArtifact(realBuildContext, {
        platform: 'ios',
        ascKey: { keyId: 'x', issuerId: 'y', p8: '' },
      }),
    ).rejects.toThrow(/Android only/);
  }

  it(
    'rejects iOS credentials (wrong platform) outside dry-run',
    rejectsIOSCredentialsWrongPlatformOutsideDryRun,
  );
}

describe(
  'gradleBuildEngine - dry-run rehearses without building or signing',
  describeGradleBuildEngineDryRunRehearsesWithoutBuildingOrSigning,
);
