import { describe, expect, it } from "vitest";
import { parseArtifactUrl, parseBuildNumber } from "./eas.js";

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

describe("EAS adapter — parsing `eas build --json` output", () => {
  it("extracts the downloadable artifact URL despite leading log lines", () => {
    expect(parseArtifactUrl(easJson)).toBe("https://expo.dev/artifacts/abc/app.ipa");
  });

  it("falls back to buildUrl when applicationArchiveUrl is absent", () => {
    const json = '[{"artifacts":{"buildUrl":"https://expo.dev/b/x.ipa"}}]';
    expect(parseArtifactUrl(json)).toBe("https://expo.dev/b/x.ipa");
  });

  it("returns null when no artifact URL is present (CLI shape drift)", () => {
    expect(parseArtifactUrl('[{"status":"ERRORED"}]')).toBeNull();
    expect(parseArtifactUrl("not json at all")).toBeNull();
  });

  it("reads the build number, defaulting to 0 when EAS doesn't report one", () => {
    expect(parseBuildNumber(easJson)).toBe(42);
    expect(parseBuildNumber('[{"buildNumber":7}]')).toBe(7);
    expect(parseBuildNumber("[{}]")).toBe(0);
    expect(parseBuildNumber("garbage")).toBe(0);
  });
});
