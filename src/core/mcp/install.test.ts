import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LAUNCH_SERVER_ENTRY, clientConfigPath, installServer, mergeServerEntry } from "./install.js";

describe("mergeServerEntry", () => {
  it("adds the launch entry to an empty document", () => {
    const { config, changed } = mergeServerEntry({}, "launch", LAUNCH_SERVER_ENTRY);
    expect(changed).toBe(true);
    expect(config).toEqual({ mcpServers: { launch: { command: "launch", args: ["mcp"] } } });
  });

  it("preserves existing servers and unrelated keys", () => {
    const existing = { theme: "dark", mcpServers: { other: { command: "other-bin", args: [] } } };
    const { config } = mergeServerEntry(existing, "launch", LAUNCH_SERVER_ENTRY);
    expect(config).toEqual({
      theme: "dark",
      mcpServers: {
        other: { command: "other-bin", args: [] },
        launch: { command: "launch", args: ["mcp"] },
      },
    });
  });

  it("is idempotent: an identical existing entry is a no-op", () => {
    const existing = { mcpServers: { launch: { command: "launch", args: ["mcp"] } } };
    const { config, changed } = mergeServerEntry(existing, "launch", LAUNCH_SERVER_ENTRY);
    expect(changed).toBe(false);
    expect(config).toBe(existing);
  });

  it("replaces a malformed (non-object) mcpServers field rather than trusting it", () => {
    const { config, changed } = mergeServerEntry({ mcpServers: "broken" }, "launch", LAUNCH_SERVER_ENTRY);
    expect(changed).toBe(true);
    expect(config).toEqual({ mcpServers: { launch: { command: "launch", args: ["mcp"] } } });
  });
});

describe("clientConfigPath", () => {
  it("points Claude Code at a project-local .mcp.json", () => {
    expect(clientConfigPath("claude-code", "/repo")).toBe(join("/repo", ".mcp.json"));
  });

  it("points Cursor at .cursor/mcp.json", () => {
    expect(clientConfigPath("cursor", "/repo")).toBe(join("/repo", ".cursor", "mcp.json"));
  });

  it("points Claude Desktop at its per-OS application-support config (not project-local)", () => {
    const path = clientConfigPath("claude-desktop", "/repo", "/home/me");
    expect(path).toContain("claude_desktop_config.json");
    expect(path).not.toContain("/repo");
  });
});

describe("installServer", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "launch-mcp-install-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes .mcp.json under the cwd and reports the change", () => {
    const { path, changed } = installServer("claude-code", dir);
    expect(changed).toBe(true);
    expect(path).toBe(join(dir, ".mcp.json"));
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      mcpServers: { launch: { command: "launch", args: ["mcp"] } },
    });
  });

  it("re-running is a no-op once configured", () => {
    installServer("claude-code", dir);
    const { changed } = installServer("claude-code", dir);
    expect(changed).toBe(false);
  });

  it("merges into an existing config without disturbing other servers", () => {
    writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x", args: [] } } }));
    installServer("claude-code", dir);
    const written = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8")) as Record<string, unknown>;
    expect(Object.keys(written["mcpServers"] as Record<string, unknown>).sort()).toEqual(["launch", "other"]);
  });
});
