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
    const names = parseFastfile(SAMPLE_FASTFILE)
      .lanes.map((lane) => lane.name)
      .sort();
    expect(names).toEqual(["beta", "play", "prepare", "release"]);
  });

  it("attributes each lane to its platform block and scopes actions to its body", () => {
    const lanes = parseFastfile(SAMPLE_FASTFILE).lanes;
    const beta = lanes.find((lane) => lane.name === "beta");
    expect(beta?.platform).toBe("ios");
    expect(beta?.actions.sort()).toEqual(["gym", "match", "pilot"]);
    const play = lanes.find((lane) => lane.name === "play");
    expect(play?.platform).toBe("android");
    expect(play?.actions).toEqual(["supply"]);
    // gym lives in :beta, not in :release — body scoping keeps them apart.
    expect(lanes.find((lane) => lane.name === "release")?.actions).toEqual(["deliver"]);
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
    expect(setup?.lanes.map((lane) => lane.name)).toContain("beta");
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

  it("maps each lane to its Launch commands and keeps signing as a manual follow-up", () => {
    const notes = migrateFastlane(dir, [app()]).notes;
    const mapped = notesAt(notes, "mapped").map((note) => note.message);
    expect(mapped).toContain("lane :beta (ios) → launch build + launch release --track testing.");
    expect(mapped).toContain("lane :release (ios) → launch release.");
    expect(mapped).toContain("lane :play (android) → launch release (Android).");
    const manual = notesAt(notes, "manual").map((note) => note.message);
    expect(manual.some((message) => message.includes("match/cert/sigh"))).toBe(true);
  });

  it("reports a custom lane with no recognized actions as a manual follow-up", () => {
    writeFileSync(join(dir, "fastlane", "Fastfile"), "lane :smoke do\n  sh('echo hi')\nend\n");
    const manual = notesAt(migrateFastlane(dir, [app()]).notes, "manual").map((note) => note.message);
    expect(manual.some((message) => message.includes("Custom lanes (smoke)"))).toBe(true);
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

  it("imports the fastlane/metadata folder into store.config.json and drops the Deliverfile follow-up", () => {
    const appleLocale = join(dir, "fastlane", "metadata", "en-US");
    mkdirSync(appleLocale, { recursive: true });
    writeFileSync(join(appleLocale, "name.txt"), "Alpha");
    writeFileSync(join(appleLocale, "keywords.txt"), "todo, tasks");
    const androidLocale = join(dir, "fastlane", "metadata", "android", "en-US");
    mkdirSync(androidLocale, { recursive: true });
    writeFileSync(join(androidLocale, "title.txt"), "Alpha");
    writeFileSync(join(androidLocale, "full_description.txt"), "The full description.");

    const result = migrateFastlane(dir, [app()]);
    const store = JSON.parse(artifact(result.artifacts, "store.config.json").contents) as {
      apple?: { info: Record<string, { title?: string; keywords?: string[] }> };
      android?: { info: Record<string, { title?: string }> };
    };
    expect(store.apple?.info["en-US"]?.title).toBe("Alpha");
    expect(store.apple?.info["en-US"]?.keywords).toEqual(["todo", "tasks"]);
    expect(store.android?.info["en-US"]?.title).toBe("Alpha");
    expect(
      notesAt(result.notes, "mapped").some((note) => note.message.includes("Imported your fastlane metadata")),
    ).toBe(true);
    expect(notesAt(result.notes, "manual").some((note) => note.message.includes("Deliverfile"))).toBe(false);
  });

  it("seeds .env.example with KEYS discovered in fastlane dotenv files (values dropped)", () => {
    writeFileSync(join(dir, "fastlane", ".env.default"), "APP_STORE_KEY=secret\nexport SLACK_URL=https://hooks\n");
    const env = artifact(migrateFastlane(dir, [app()]).artifacts, ".env.example").contents;
    expect(env).toContain("APP_STORE_KEY=");
    expect(env).toContain("SLACK_URL=");
    expect(env).not.toContain("APP_STORE_KEY=secret");
    expect(env).not.toContain("https://hooks");
  });

  it("surfaces a non-git match storage backend in the signing note", () => {
    writeFileSync(join(dir, "fastlane", "Matchfile"), ['type("appstore")', 'storage_mode("google_cloud")'].join("\n"));
    const info = notesAt(migrateFastlane(dir, [app()]).notes, "info").map((note) => note.message);
    expect(info.some((message) => message.includes("google_cloud"))).toBe(true);
  });
});
