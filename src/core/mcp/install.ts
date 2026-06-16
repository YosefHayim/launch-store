/**
 * Wire `launch mcp` into an AI client's MCP configuration — `launch mcp install` and the `agents init` step.
 *
 * An MCP client (Claude Code, Cursor, Claude Desktop) discovers servers from a JSON file with an
 * `mcpServers` map. Installing Launch means adding ONE `launch` entry to that map without disturbing the
 * operator's existing servers or unrelated keys — a surgical merge, not an overwrite. The merge is a pure
 * function ({@link mergeServerEntry}) over parsed JSON so it is unit-tested with no filesystem; the file
 * read/parse/write wrapper ({@link installServer}) is the only impure part and is shared by the command
 * and by `launch agents init`, so there is one merge implementation with two callers.
 *
 * Why a hand-rolled merge over a config library: the rule is tiny and fixed (one known key in one known
 * map), and Launch keeps its dependency list lean (the same reason `jsonSchema.ts` hand-rolls validation),
 * so pulling in a JSON-merge dependency would cost more than it saves.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { asRecord } from "../json.js";

/** The MCP clients `launch mcp install` knows how to wire, by their config-file convention. */
export type McpClient = "claude-code" | "cursor" | "claude-desktop";

/** The server entry written under `mcpServers.launch` — how a client spawns the stdio server. */
export interface McpServerEntry {
  command: string;
  args: string[];
}

/** The default Launch entry: run the installed `launch mcp` over stdio. */
export const LAUNCH_SERVER_ENTRY: McpServerEntry = { command: "launch", args: ["mcp"] };

/**
 * Resolve a client's MCP config file path. Claude Code and Cursor use a project-local file (so the server
 * is wired per-repo, committable); Claude Desktop uses its per-OS application-support config (a global
 * file, since the desktop app has no project scope). `cwd`/`home` are injected so a test can point them at
 * a temp dir, and so the path logic is exercised without touching the real home directory.
 */
export function clientConfigPath(client: McpClient, cwd: string = process.cwd(), home: string = homedir()): string {
  switch (client) {
    case "claude-code":
      return join(cwd, ".mcp.json");
    case "cursor":
      return join(cwd, ".cursor", "mcp.json");
    case "claude-desktop":
      return platform() === "win32"
        ? join(home, "AppData", "Roaming", "Claude", "claude_desktop_config.json")
        : join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
}

/** The result of a merge: the document to write, and whether it actually changed (idempotent re-install). */
export interface MergeResult {
  /** The full config object to serialize back to disk. */
  config: Record<string, unknown>;
  /** `false` when `launch` was already present and identical — nothing to write. */
  changed: boolean;
}

/**
 * Merge a `launch` server entry into an existing parsed client config, preserving every other key and
 * every other server. Returns the updated document and whether it changed (an identical existing entry is
 * a no-op, so re-running install never rewrites the file). A non-object existing `mcpServers` is replaced
 * with a fresh map rather than trusted — a malformed field shouldn't wedge the install.
 */
export function mergeServerEntry(existing: Record<string, unknown>, name: string, entry: McpServerEntry): MergeResult {
  const servers = asRecord(existing["mcpServers"]) ?? {};
  const current = asRecord(servers[name]);
  if (current?.["command"] === entry.command && JSON.stringify(current["args"]) === JSON.stringify(entry.args)) {
    return { config: existing, changed: false };
  }
  return {
    config: { ...existing, mcpServers: { ...servers, [name]: { command: entry.command, args: [...entry.args] } } },
    changed: true,
  };
}

/**
 * Install the Launch server into a client's MCP config file: read+parse the existing file (an absent or
 * unparseable file starts from an empty document), {@link mergeServerEntry}, and write it back only when
 * something changed. Returns the resolved path and whether the file was written, so the caller can report
 * "installed" vs "already configured". Creates the parent directory as needed (`.cursor/`, the Claude
 * Desktop support dir).
 */
export function installServer(
  client: McpClient,
  cwd: string = process.cwd(),
  entry: McpServerEntry = LAUNCH_SERVER_ENTRY,
): { path: string; changed: boolean } {
  const path = clientConfigPath(client, cwd);
  const existing = readJsonObject(path);
  const { config, changed } = mergeServerEntry(existing, "launch", entry);
  if (changed) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  }
  return { path, changed };
}

/** Read and parse a JSON object from `path`; a missing file or non-object content yields an empty object. */
function readJsonObject(path: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(readFileSync(path, "utf8"))) ?? {};
  } catch {
    return {};
  }
}
