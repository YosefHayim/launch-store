import { describe, expect, it } from "vitest";
import { READ_TOOLS } from "./tools.js";
import type { McpTool } from "./types.js";

/** Look a tool up by its advertised name, failing loudly if the registry no longer has it. */
function byName(name: string): McpTool {
  const tool = READ_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`tool ${name} missing from READ_TOOLS`);
  return tool;
}

/** Parse the JSON a successful read tool emits as its single text block. */
function payload(result: { content: { text: string }[] }): unknown {
  return JSON.parse(result.content[0]!.text);
}

describe("READ_TOOLS registry", () => {
  it("exposes the v1 read-only surface, every tool on the read tier", () => {
    expect(READ_TOOLS.map((tool) => tool.name)).toEqual([
      "plan",
      "drift",
      "audit",
      "store_doctor",
      "iap_doctor",
      "config_validate",
      "config_schema",
      "config_docs",
      "snapshot_list",
      "snapshot_diff",
      "snapshot_export",
      "doctor",
    ]);
    expect(READ_TOOLS.every((tool) => tool.capability === "read")).toBe(true);
  });

  it("gives every tool a snake_case name and an object input schema", () => {
    for (const tool of READ_TOOLS) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});

describe("config introspection tools", () => {
  it("config_schema returns the launch.config JSON Schema", async () => {
    const schema = payload(await byName("config_schema").handler({})) as Record<string, unknown>;
    expect(schema["$ref"]).toBeDefined();
    expect(schema["definitions"]).toBeDefined();
  });

  it("config_docs returns the field reference as Markdown", async () => {
    const docs = payload(await byName("config_docs").handler({})) as { markdown: string };
    expect(typeof docs.markdown).toBe("string");
    expect(docs.markdown.length).toBeGreaterThan(0);
  });
});

describe("snapshot tool argument guards", () => {
  it("snapshot_diff requires a baseline", async () => {
    await expect(byName("snapshot_diff").handler({})).rejects.toThrow("`baseline` is required.");
  });

  it("snapshot_diff throws on an unknown baseline snapshot", async () => {
    await expect(byName("snapshot_diff").handler({ baseline: "no-such-snapshot-xyz" })).rejects.toThrow(
      'No snapshot named "no-such-snapshot-xyz"',
    );
  });

  it("snapshot_export requires a name", async () => {
    await expect(byName("snapshot_export").handler({})).rejects.toThrow("`name` is required.");
  });

  it("snapshot_export throws on an unknown snapshot when not capturing", async () => {
    await expect(byName("snapshot_export").handler({ name: "no-such-snapshot-xyz" })).rejects.toThrow(
      'No snapshot named "no-such-snapshot-xyz"',
    );
  });
});
