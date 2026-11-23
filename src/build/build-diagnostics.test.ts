import { describe, expect, it } from 'vitest';
import { diagnoseBuildLog, formatDiagnoses } from './build-diagnostics.ts';
function describeDiagnoseBuildLogMapsNativeErrorsToACauseFix() {
  function recognizesAMissingSigningProfile() {
    const [diagnosis] = diagnoseBuildLog("error: No profiles for 'com.acme.app' were found");
    expect(diagnosis?.title).toContain('Code signing');
    expect(diagnosis?.fix).toContain('launch-store creds setup');
  }

  it('recognizes a missing signing profile', recognizesAMissingSigningProfile);

  function recognizesTheXcode26CocoaPodsProvisioningProfileArchiveFailureIssue301() {
    const log = [
      'Pods.xcodeproj: error: SomeLibraryPod does not support provisioning profiles. SomeLibraryPod does',
      'not support provisioning profiles, but provisioning profile',
      'Launch_com.example.app_AppStore has been manually specified.',
      'Exit status: 65',
    ].join('\n');
    const [diagnosis] = diagnoseBuildLog(log);

    expect(diagnosis?.title).toContain('leaked onto CocoaPods');
    expect(diagnosis?.fix).toContain('app target');
  }

  it(
    'recognizes the Xcode 26 CocoaPods provisioning-profile archive failure (issue #301)',
    recognizesTheXcode26CocoaPodsProvisioningProfileArchiveFailureIssue301,
  );

  function recognizesTheCocoaPodsSandboxOutOfSyncError() {
    const [diagnosis] = diagnoseBuildLog('The sandbox is not in sync with the Podfile.lock.');
    expect(diagnosis?.title).toContain('sandbox out of sync');
    expect(diagnosis?.fix).toContain('--clean');
  }

  it(
    'recognizes the CocoaPods sandbox-out-of-sync error',
    recognizesTheCocoaPodsSandboxOutOfSyncError,
  );

  function recognizesAMissingAndroidSDK() {
    const [diagnosis] = diagnoseBuildLog('SDK location not found. Define a valid SDK location.');
    expect(diagnosis?.title).toContain('Android SDK location');
    expect(diagnosis?.fix).toContain('ANDROID_HOME');
  }

  it('recognizes a missing Android SDK', recognizesAMissingAndroidSDK);

  function recognizesAWrongJDKVersion() {
    const [diagnosis] = diagnoseBuildLog('Unsupported class file major version 65');
    expect(diagnosis?.title).toContain('JDK');
    expect(diagnosis?.fix).toContain('JDK 17');
  }

  it('recognizes a wrong JDK version', recognizesAWrongJDKVersion);

  function recognizesAGradleOutOfMemoryFailure() {
    const [diagnosis] = diagnoseBuildLog('> java.lang.OutOfMemoryError: Java heap space');
    expect(diagnosis?.title).toContain('out of memory');
    expect(diagnosis?.fix).toContain('Xmx');
  }

  it('recognizes a Gradle out-of-memory failure', recognizesAGradleOutOfMemoryFailure);

  function returnsNothingForAnUnrecognizedLog() {
    expect(diagnoseBuildLog('some entirely unremarkable output line')).toEqual([]);
  }

  it('returns nothing for an unrecognized log', returnsNothingForAnUnrecognizedLog);

  function deDuplicatesAndPreservesTableOrderAcrossManyMatchingLines() {
    const log = [
      'SDK location not found',
      "error: No profiles for 'com.acme.app' were found",
      "error: No profiles for 'com.acme.app' were found", // repeated - must not duplicate
    ].join('\n');

    function readTitle(d: { title: string; cause: string; fix: string }) {
      return d.title;
    }

    const titles = diagnoseBuildLog(log).map(readTitle);

    expect(titles).toEqual([
      'Code signing - no usable certificate or profile',
      'Android SDK location not found',
    ]);
  }

  it(
    'de-duplicates and preserves table order across many matching lines',
    deDuplicatesAndPreservesTableOrderAcrossManyMatchingLines,
  );
}

describe(
  'diagnoseBuildLog - maps native errors to a cause + fix',
  describeDiagnoseBuildLogMapsNativeErrorsToACauseFix,
);
function describeFormatDiagnoses() {
  function rendersASingleCauseBlockWithWhyFix() {
    const text = formatDiagnoses(diagnoseBuildLog('ENOSPC: no space left on device'));
    expect(text).toContain('Likely cause:');
    expect(text).toContain('Why:');
    expect(text).toContain('Fix:');
  }

  it('renders a single-cause block with why + fix', rendersASingleCauseBlockWithWhyFix);

  function usesThePluralHeaderWhenMoreThanOneMatched() {
    const text = formatDiagnoses(
      diagnoseBuildLog('SDK location not found\nUnsupported class file major version 65'),
    );
    expect(text).toContain('Likely causes:');
  }

  it(
    'uses the plural header when more than one matched',
    usesThePluralHeaderWhenMoreThanOneMatched,
  );

  function returnsAnEmptyStringWhenThereIsNothingToReport() {
    const diagnoses = formatDiagnoses([]);
    expect(diagnoses).toBe('');
  }

  it(
    'returns an empty string when there is nothing to report',
    returnsAnEmptyStringWhenThereIsNothingToReport,
  );
}

describe('formatDiagnoses', describeFormatDiagnoses);
