import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readWhatsNew, resolveReleaseType, shouldNudgeRelease } from "./release.js";

describe("shouldNudgeRelease — second confirm only for incremental artifacts", () => {
  it("does not nudge a clean (from-scratch) artifact", () => {
    expect(shouldNudgeRelease({ clean: true })).toBe(false);
  });

  it("nudges an incrementally-built artifact before public release", () => {
    expect(shouldNudgeRelease({ clean: false })).toBe(true);
  });
});

describe("resolveReleaseType — flags over config over default", () => {
  it("defaults to AFTER_APPROVAL when nothing is set", () => {
    expect(resolveReleaseType({}, undefined)).toEqual({ releaseType: "AFTER_APPROVAL" });
  });

  it("honors a configured release type", () => {
    expect(resolveReleaseType({}, "MANUAL")).toEqual({ releaseType: "MANUAL" });
  });

  it("--manual overrides the config", () => {
    expect(resolveReleaseType({ manual: true }, "SCHEDULED")).toEqual({ releaseType: "MANUAL" });
  });

  it("--scheduled carries the ISO date through", () => {
    expect(resolveReleaseType({ scheduled: "2026-07-01T12:00:00Z" }, undefined)).toEqual({
      releaseType: "SCHEDULED",
      earliestReleaseDate: "2026-07-01T12:00:00Z",
    });
  });

  it("rejects a non-ISO scheduled date", () => {
    expect(() => resolveReleaseType({ scheduled: "next tuesday" }, undefined)).toThrow(/ISO-8601/);
  });

  it("rejects passing both --manual and --scheduled", () => {
    expect(() => resolveReleaseType({ manual: true, scheduled: "2026-07-01T12:00:00Z" }, undefined)).toThrow(
      /only one/,
    );
  });
});

describe("readWhatsNew — per-locale release notes from store.config.json", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "launch-whatsnew-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns [] when there's no store.config.json", () => {
    expect(readWhatsNew(dir)).toEqual([]);
  });

  it("reads releaseNotes for each locale that has them", () => {
    writeFileSync(
      join(dir, "store.config.json"),
      JSON.stringify({
        apple: {
          info: {
            "en-US": { releaseNotes: "Bug fixes.", description: "App" },
            "fr-FR": { releaseNotes: "Corrections." },
            "de-DE": { description: "no notes here" },
          },
        },
      }),
    );
    expect(readWhatsNew(dir)).toEqual([
      { locale: "en-US", text: "Bug fixes." },
      { locale: "fr-FR", text: "Corrections." },
    ]);
  });
});
