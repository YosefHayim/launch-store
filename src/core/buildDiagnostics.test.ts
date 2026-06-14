import { describe, expect, it } from "vitest";
import { diagnoseBuildLog, formatDiagnoses } from "./buildDiagnostics.js";

describe("diagnoseBuildLog — maps native errors to a cause + fix", () => {
  it("recognizes a missing signing profile", () => {
    const [diagnosis] = diagnoseBuildLog("error: No profiles for 'com.acme.app' were found");
    expect(diagnosis?.title).toContain("Code signing");
    expect(diagnosis?.fix).toContain("launch creds setup");
  });

  it("recognizes the CocoaPods sandbox-out-of-sync error", () => {
    const [diagnosis] = diagnoseBuildLog("The sandbox is not in sync with the Podfile.lock.");
    expect(diagnosis?.title).toContain("sandbox out of sync");
    expect(diagnosis?.fix).toContain("--clean");
  });

  it("recognizes a missing Android SDK", () => {
    const [diagnosis] = diagnoseBuildLog("SDK location not found. Define a valid SDK location.");
    expect(diagnosis?.title).toContain("Android SDK location");
    expect(diagnosis?.fix).toContain("ANDROID_HOME");
  });

  it("recognizes a wrong JDK version", () => {
    const [diagnosis] = diagnoseBuildLog("Unsupported class file major version 65");
    expect(diagnosis?.title).toContain("JDK");
    expect(diagnosis?.fix).toContain("JDK 17");
  });

  it("recognizes a Gradle out-of-memory failure", () => {
    const [diagnosis] = diagnoseBuildLog("> java.lang.OutOfMemoryError: Java heap space");
    expect(diagnosis?.title).toContain("out of memory");
    expect(diagnosis?.fix).toContain("Xmx");
  });

  it("returns nothing for an unrecognized log", () => {
    expect(diagnoseBuildLog("some entirely unremarkable output line")).toEqual([]);
  });

  it("de-duplicates and preserves table order across many matching lines", () => {
    const log = [
      "SDK location not found",
      "error: No profiles for 'com.acme.app' were found",
      "error: No profiles for 'com.acme.app' were found", // repeated — must not duplicate
    ].join("\n");
    const titles = diagnoseBuildLog(log).map((d) => d.title);
    expect(titles).toEqual(["Code signing — no usable certificate or profile", "Android SDK location not found"]);
  });
});

describe("formatDiagnoses", () => {
  it("renders a single-cause block with why + fix", () => {
    const text = formatDiagnoses(diagnoseBuildLog("ENOSPC: no space left on device"));
    expect(text).toContain("Likely cause:");
    expect(text).toContain("Why:");
    expect(text).toContain("Fix:");
  });

  it("uses the plural header when more than one matched", () => {
    const text = formatDiagnoses(diagnoseBuildLog("SDK location not found\nUnsupported class file major version 65"));
    expect(text).toContain("Likely causes:");
  });

  it("returns an empty string when there is nothing to report", () => {
    expect(formatDiagnoses([])).toBe("");
  });
});
