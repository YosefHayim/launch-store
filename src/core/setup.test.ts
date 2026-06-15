import { describe, expect, it } from "vitest";
import { type SetupReadiness, formatSetupBoard, pendingTodos, toolchainReadinessRows } from "./setup.js";
import type { Tool } from "./toolchain.js";

/** A three-tool slice covering every branch: a required guide tool, a required brew tool, a recommended one. */
const TOOLS: Tool[] = [
  {
    label: "Xcode (xcodebuild)",
    command: "xcodebuild",
    tier: "required",
    install: { kind: "guide", how: "Install Xcode from the App Store." },
  },
  { label: "fastlane", command: "fastlane", tier: "required", install: { kind: "brew", formula: "fastlane" } },
  { label: "ccache", command: "ccache", tier: "recommended", install: { kind: "brew", formula: "ccache" } },
];

describe("toolchainReadinessRows", () => {
  const rows = toolchainReadinessRows(TOOLS, new Set(["fastlane"]));

  it("marks a present tool ok with no fix hint", () => {
    expect(rows.find((r) => r.label === "fastlane")).toEqual({ label: "fastlane", status: "ok" });
  });

  it("marks a missing required tool a todo carrying its install hint", () => {
    expect(rows.find((r) => r.label.startsWith("Xcode"))).toEqual({
      label: "Xcode (xcodebuild)",
      status: "todo",
      detail: "Install Xcode from the App Store.",
    });
  });

  it("marks a missing recommended tool advisory (info), never a gap", () => {
    const ccache = rows.find((r) => r.label === "ccache");
    expect(ccache?.status).toBe("info");
    expect(ccache?.detail).toContain("brew install ccache");
  });
});

describe("formatSetupBoard", () => {
  const readiness: SetupReadiness = {
    groups: [
      { title: "Config", rows: [{ label: "launch.config.ts", status: "ok", detail: "present" }] },
      {
        title: "Toolchain",
        rows: [
          { label: "fastlane", status: "ok" },
          { label: "Xcode", status: "todo", detail: "Install Xcode." },
        ],
      },
    ],
  };
  const lines = formatSetupBoard(readiness);

  it("renders each group title with its checks indented under it", () => {
    expect(lines).toContain("Config");
    expect(lines).toContain("  ✓ launch.config.ts — present");
    expect(lines).toContain("Toolchain");
    expect(lines).toContain("  ✓ fastlane");
    expect(lines).toContain("  ✗ Xcode — Install Xcode.");
  });

  it("separates groups with a blank line but never leads with one", () => {
    expect(lines[0]).toBe("Config");
    expect(lines).toContain("");
    expect(lines.indexOf("")).toBeGreaterThan(0);
  });
});

describe("pendingTodos", () => {
  it("flattens only the todo rows across every group, dropping ok and info", () => {
    const readiness: SetupReadiness = {
      groups: [
        { title: "Config", rows: [{ label: "launch.config.ts", status: "ok" }] },
        {
          title: "Toolchain",
          rows: [
            { label: "ccache", status: "info", detail: "recommended" },
            { label: "Xcode", status: "todo", detail: "Install Xcode." },
          ],
        },
        { title: "Apple account", rows: [{ label: "Apple account", status: "todo", detail: "launch creds set-key" }] },
      ],
    };
    expect(pendingTodos(readiness)).toEqual([
      { label: "Xcode", status: "todo", detail: "Install Xcode." },
      { label: "Apple account", status: "todo", detail: "launch creds set-key" },
    ]);
  });
});
