import { describe, expect, it } from 'vitest';
import { parseArtifactUrl, parseBuildNumber } from './eas.ts';
// A trimmed-down shape of what `eas build --json` prints, with a leading log line eas sometimes emits.
const easJson = `Building...
[
  {
    "id": "abc",
    "status": "FINISHED",
    "appBuildVersion": "42",
    "artifacts": { "applicationArchiveUrl": "https://expo.dev/artifacts/abc/app.ipa" }
  }
]`;
function describeEASAdapterParsingEasBuildPiecePiece() {
  function extractsTheDownloadableArtifactURLDespiteLeadingLogLines() {
    const artifactUrl = parseArtifactUrl(easJson);
    expect(artifactUrl).toBe('https://expo.dev/artifacts/abc/app.ipa');
  }

  it(
    'extracts the downloadable artifact URL despite leading log lines',
    extractsTheDownloadableArtifactURLDespiteLeadingLogLines,
  );

  function fallsBackToBuildUrlWhenApplicationArchiveUrlIsAbsent() {
    const json = '[{"artifacts":{"buildUrl":"https://expo.dev/b/x.ipa"}}]';
    const artifactUrl = parseArtifactUrl(json);
    expect(artifactUrl).toBe('https://expo.dev/b/x.ipa');
  }

  it(
    'falls back to buildUrl when applicationArchiveUrl is absent',
    fallsBackToBuildUrlWhenApplicationArchiveUrlIsAbsent,
  );

  function returnsNullWhenNoArtifactURLIsPresentCLIShapeDrift() {
    const artifactUrl = parseArtifactUrl('[{"status":"ERRORED"}]');
    expect(artifactUrl).toBeNull();
    expect(parseArtifactUrl('not json at all')).toBeNull();
  }

  it(
    'returns null when no artifact URL is present (CLI shape drift)',
    returnsNullWhenNoArtifactURLIsPresentCLIShapeDrift,
  );

  function readsTheBuildNumberDefaultingTo0WhenEASDoesnTReportOne() {
    const buildNumber = parseBuildNumber(easJson);

    expect(buildNumber).toBe(42);
    expect(parseBuildNumber('[{"buildNumber":7}]')).toBe(7);
    expect(parseBuildNumber('[{}]')).toBe(0);
    expect(parseBuildNumber('garbage')).toBe(0);
  }

  it(
    "reads the build number, defaulting to 0 when EAS doesn't report one",
    readsTheBuildNumberDefaultingTo0WhenEASDoesnTReportOne,
  );
}

describe(
  'EAS adapter - parsing `eas build --json` output',
  describeEASAdapterParsingEasBuildPiecePiece,
);
