import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppDescriptor } from "../types.js";
import {
  migrateFastlane,
  parseAppfile,
  parseFastfile,
  parseMatchfile,
  parseSupplyfile,
  readFastlaneSetup,
} from "./fastlane.js";
import type { MigrationArtifact, MigrationNote, MigrationNoteLevel } from "./types.js";

/** A realistic Appfile carrying both team ids, the Apple ID, and both platform identifiers. */
const SAMPLE_APPFILE = [
  'app_identifier("com.acme.alpha")',
  'apple_id("you@example.com")',
  'team_id "ABCD1234"',
  'itc_team_id "99887766"',
  'package_name("com.acme.alpha")',
].join("\n");

/** A Fastfile exercising both `lane` and `private_lane` plus a spread of recognized actions. */
const SAMPLE_FASTFILE = `
default_platform(:ios)

platform :ios do
  desc "Ship a beta"
  lane :beta do
    match(type: "appstore")
    gym(scheme: "Alpha")
    pilot
  end

  private_lane :prepare do
    capture_screenshots
  end

  lane :release do
    deliver
  end
end

platform :android do
  lane :play do
    supply(track: "internal")
  end
end
`;

const SAMPLE_MATCHFILE = ['git_url("https://github.com/acme/certs")', 'type("appstore")', 'storage_mode("git")'].join(
  "\n",
);

const SAMPLE_SUPPLYFILE = ['package_name("com.acme.alpha")', 'json_key("./play-key.json")', 'track("production")'].join(
  "\n",
);

/** A minimal app descriptor, overridable per field. */
function app(over: Partial<AppDescriptor> = {}): AppDescriptor {
  return { name: "alpha", dir: "/tmp", configPath: "/tmp/app.json", bundleId: "com.acme.alpha", ...over };
}

/** The artifact at `path`, asserting it was emitted. */
function artifact(artifacts: MigrationArtifact[], path: string): MigrationArtifact {
  const found = artifacts.find((entry) => entry.path === path);
  expect(found, `expected artifact ${path}`).toBeDefined();
  return found!;
}

/** Notes at a given level. */
function notesAt(notes: MigrationNote[], level: MigrationNoteLevel): MigrationNote[] {
  return notes.filter((note) => note.level === level);
}

describe("parseAppfile", () => {
  it("reads every identifier and keeps team_id distinct from itc_team_id", () => {
    const data = parseAppfile(SAMPLE_APPFILE);
    expect(data.appIdentifier).toBe("com.acme.alpha");
    expect(data.appleId).toBe("you@example.com");
    expect(data.teamId).toBe("ABCD1234");
    expect(data.itcTeamId).toBe("99887766");
    expect(data.packageName).toBe("com.acme.alpha");
  });

  it("returns only the directives present", () => {
    expect(parseAppfile('apple_id("solo@example.com")')).toEqual({ appleId: "solo@example.com" });
  });

  it("treats an empty value as absent", () => {
    expect(parseAppfile('team_id ""')).toEqual({});
  });
});

describe("parseMatchfile", () => {
  it("reads the signing strategy", () => {
    expect(parseMatchfile(SAMPLE_MATCHFILE)).toEqual({
      gitUrl: "https://github.com/acme/certs",
      type: "appstore",
      storageMode: "git",
    });
  });
});

describe("parseSupplyfile", () => {
  it("reads the Play upload defaults", () => {
    expect(parseSupplyfile(SAMPLE_SUPPLYFILE)).toEqual({
      packageName: "com.acme.alpha",
      jsonKey: "./play-key.json",
      track: "production",
    });
  });
});

describe("parseFastfile", () => {
  it("collects lane names from both lane and private_lane", () => {
    expect(parseFastfile(SAMPLE_FASTFILE).lanes.sort()).toEqual(["beta", "play", "prepare", "release"]);
  });

  it("detects the recognized actions used anywhere in the file", () => {
    const { actions } = parseFastfile(SAMPLE_FASTFILE);
    expect(actions).toContain("match");
    expect(actions).toContain("gym");
    expect(actions).toContain("pilot");
    expect(actions).toContain("deliver");
    expect(actions).toContain("supply");
    expect(actions).toContain("capture_screenshots");
    expect(actions).not.toContain("upload_to_play_store");
  });
});

describe("readFastlaneSetup", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "launch-fastlane-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when the project has no fastlane files", () => {
    expect(readFastlaneSetup(dir)).toBeNull();
  });

  it("reads files from the conventional fastlane/ subdirectory", () => {
    mkdirSync(join(dir, "fastlane"));
    writeFileSync(join(dir, "fastlane", "Appfile"), SAMPLE_APPFILE);
    writeFileSync(join(dir, "fastlane", "Fastfile"), SAMPLE_FASTFILE);
    const setup = readFastlaneSetup(dir);
    expect(setup?.appfile?.appIdentifier).toBe("com.acme.alpha");
    expect(setup?.lanes).toContain("beta");
    expect(setup?.hasDeliverfile).toBe(false);
  });

  it("reads files placed at the project root", () => {
    writeFileSync(join(dir, "Appfile"), SAMPLE_APPFILE);
    expect(readFastlaneSetup(dir)?.appfile?.teamId).toBe("ABCD1234");
  });
});

describe("migrateFastlane", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "launch-fastlane-"));
    mkdirSync(join(dir, "fastlane"));
    writeFileSync(join(dir, "fastlane", "Appfile"), SAMPLE_APPFILE);
    writeFileSync(join(dir, "fastlane", "Fastfile"), SAMPLE_FASTFILE);
    writeFileSync(join(dir, "fastlane", "Matchfile"), SAMPLE_MATCHFILE);
    writeFileSync(join(dir, "fastlane", "Supplyfile"), SAMPLE_SUPPLYFILE);
    writeFileSync(join(dir, "fastlane", "Deliverfile"), 'app_identifier("com.acme.alpha")');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when there is no fastlane setup", () => {
    rmSync(join(dir, "fastlane"), { recursive: true, force: true });
    expect(() => migrateFastlane(dir, [app()])).toThrow(/No fastlane setup/);
  });

  it("emits the starter launch.config.ts, .env.example, and store.config.json", () => {
    const result = migrateFastlane(dir, [app()]);
    const paths = result.artifacts.map((entry) => entry.path);
    expect(paths).toContain("launch.config.ts");
    expect(paths).toContain(".env.example");
    expect(paths).toContain("store.config.json");
    expect(artifact(result.artifacts, "launch.config.ts").contents).toContain("defineConfig");
  });

  it("reports lanes and signing as manual follow-ups", () => {
    const manual = notesAt(migrateFastlane(dir, [app()]).notes, "manual").map((note) => note.message);
    expect(manual.some((message) => message.includes("lanes"))).toBe(true);
    expect(manual.some((message) => message.includes("match/cert/sigh"))).toBe(true);
  });

  it("maps gym/pilot/deliver/supply to Launch commands", () => {
    const mapped = notesAt(migrateFastlane(dir, [app()]).notes, "mapped").map((note) => note.message);
    expect(mapped.some((message) => message.includes("launch build"))).toBe(true);
    expect(mapped.some((message) => message.includes("TestFlight"))).toBe(true);
    expect(mapped.some((message) => message.includes("deliver"))).toBe(true);
  });

  it("reports the Supplyfile track and a Deliverfile as manual", () => {
    const manual = notesAt(migrateFastlane(dir, [app()]).notes, "manual").map((note) => note.message);
    expect(manual.some((message) => message.includes("Play track"))).toBe(true);
    expect(manual.some((message) => message.includes("Deliverfile"))).toBe(true);
  });

  it("reports the Appfile app_identifier and detected ids as info", () => {
    const info = notesAt(migrateFastlane(dir, [app({ packageName: "com.acme.alpha" })]).notes, "info").map(
      (note) => note.message,
    );
    expect(info.some((message) => message.includes("app_identifier"))).toBe(true);
    expect(info.some((message) => message.includes("bundle id"))).toBe(true);
    expect(info.some((message) => message.includes("package"))).toBe(true);
  });

  it("skips store.config.json when one already exists", () => {
    writeFileSync(join(dir, "store.config.json"), "{}");
    const result = migrateFastlane(dir, [app()]);
    expect(result.artifacts.map((entry) => entry.path)).not.toContain("store.config.json");
    expect(notesAt(result.notes, "skipped").some((note) => note.message.includes("store.config.json"))).toBe(true);
  });
});
