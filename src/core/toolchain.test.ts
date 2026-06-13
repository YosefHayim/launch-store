/**
 * Tests for the macOS toolchain installer. The pure planners are checked directly; the
 * {@link ensureToolchain} orchestration runs against a fake {@link ToolchainIo} that simulates an
 * install (a `brew install` / Homebrew bootstrap marks the relevant command "present") so the
 * detect → install → re-verify loop is exercised with zero real shell-out.
 */

import { describe, it, expect } from "vitest";
import { REQUIRED_TOOLS, ensureToolchain, fixHint, planInstall, type ToolchainIo } from "./toolchain.js";

/** Map each brew formula back to the command it provides, so the fake can mark it present after install. */
const FORMULA_TO_COMMAND = new Map(
  REQUIRED_TOOLS.flatMap((tool) =>
    tool.install.kind === "brew" ? [[tool.install.formula, tool.command] as const] : [],
  ),
);

/** Build a fake IO over a mutable "present on PATH" set, recording prompts/runs for assertions. */
function makeIo(opts: { present: string[]; confirm?: boolean; confirmText?: boolean }): {
  io: ToolchainIo;
  logs: string[];
  runs: string[][];
} {
  const present = new Set(opts.present);
  const logs: string[] = [];
  const runs: string[][] = [];
  const io: ToolchainIo = {
    exists: async (command) => present.has(command),
    run: async (command, args) => {
      runs.push([command, ...args]);
      if (command === "brew" && args[0] === "install") {
        for (const formula of args.slice(1)) {
          const provided = FORMULA_TO_COMMAND.get(formula);
          if (provided) present.add(provided);
        }
      } else if (command === "/bin/bash") {
        present.add("brew"); // the Homebrew installer bootstraps `brew`
      }
    },
    confirm: async () => opts.confirm ?? true,
    confirmText: async () => opts.confirmText ?? true,
    log: (message) => logs.push(message),
  };
  return { io, logs, runs };
}

const ALL_COMMANDS = REQUIRED_TOOLS.map((tool) => tool.command);

describe("fixHint", () => {
  it("renders a brew tool as `brew install <formula>`", () => {
    const fastlane = REQUIRED_TOOLS.find((tool) => tool.command === "fastlane")!;
    expect(fixHint(fastlane)).toBe("brew install fastlane");
  });

  it("renders a guided tool as its guide text", () => {
    const xcode = REQUIRED_TOOLS.find((tool) => tool.command === "xcodebuild")!;
    expect(fixHint(xcode)).toMatch(/App Store/);
  });
});

describe("planInstall", () => {
  it("splits missing tools into brew-installable and guided", () => {
    const { brew, guided } = planInstall(REQUIRED_TOOLS);
    expect(guided.map((tool) => tool.command)).toEqual(["xcodebuild"]);
    expect(brew.map((tool) => tool.command)).toEqual(["ruby", "fastlane", "pod", "openssl", "node"]);
  });
});

describe("ensureToolchain", () => {
  it("is a no-op success on a non-macOS host", async () => {
    const { io, runs } = makeIo({ present: [] });
    expect(await ensureToolchain({ io, platform: "linux" })).toBe(true);
    expect(runs).toEqual([]);
  });

  it("succeeds without installing when everything is present", async () => {
    const { io, runs } = makeIo({ present: [...ALL_COMMANDS, "brew"] });
    expect(await ensureToolchain({ io, platform: "darwin" })).toBe(true);
    expect(runs).toEqual([]);
  });

  it("installs the missing brew tools as one batch, then re-verifies green", async () => {
    const present = ALL_COMMANDS.filter((command) => command !== "fastlane" && command !== "pod");
    const { io, runs } = makeIo({ present: [...present, "brew"] });
    expect(await ensureToolchain({ io, platform: "darwin", assumeYes: true })).toBe(true);
    expect(runs).toContainEqual(["brew", "install", "fastlane", "cocoapods"]);
  });

  it("bootstraps Homebrew first when it's missing, then installs", async () => {
    const present = ALL_COMMANDS.filter((command) => command !== "fastlane"); // no fastlane, no brew
    const { io, runs } = makeIo({ present });
    expect(await ensureToolchain({ io, platform: "darwin", assumeYes: true })).toBe(true);
    expect(runs[0]?.[0]).toBe("/bin/bash"); // Homebrew installer ran first
    expect(runs).toContainEqual(["brew", "install", "fastlane"]);
  });

  it("returns false and installs nothing when the user declines the Homebrew installer", async () => {
    const present = ALL_COMMANDS.filter((command) => command !== "fastlane"); // no fastlane, no brew
    const { io, runs, logs } = makeIo({ present, confirmText: false });
    expect(await ensureToolchain({ io, platform: "darwin" })).toBe(false);
    expect(runs).toEqual([]);
    expect(logs.join("\n")).toMatch(/Homebrew isn't available/);
  });

  it("returns false and installs nothing when the user declines the brew batch", async () => {
    const present = ALL_COMMANDS.filter((command) => command !== "fastlane");
    const { io, runs, logs } = makeIo({ present: [...present, "brew"], confirm: false });
    expect(await ensureToolchain({ io, platform: "darwin" })).toBe(false);
    expect(runs).toEqual([]);
    expect(logs.join("\n")).toMatch(/Install them yourself/);
  });

  it("only guides (never auto-installs) when the lone gap is Xcode", async () => {
    const present = ALL_COMMANDS.filter((command) => command !== "xcodebuild");
    const { io, runs, logs } = makeIo({ present: [...present, "brew"], confirm: true });
    expect(await ensureToolchain({ io, platform: "darwin", assumeYes: true })).toBe(false);
    expect(runs).toEqual([]);
    expect(logs.join("\n")).toMatch(/App Store/);
  });
});
