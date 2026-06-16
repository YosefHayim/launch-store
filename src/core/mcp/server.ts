/**
 * Start the `launch mcp` server — the stdio Model Context Protocol endpoint.
 *
 * The official `@modelcontextprotocol/sdk` is an OPTIONAL dependency (so Launch's runtime dependency list
 * stays lean — the same lazy posture as the AWS SDK and the native keyring), loaded here through
 * {@link requireOptional} so a missing package becomes an actionable install hint instead of a stack
 * trace. We use the SDK's LOW-LEVEL {@link Server} (not the high-level `McpServer`, which requires zod):
 * its `setRequestHandler` accepts the SDK's own request schemas, while each tool advertises a raw JSON
 * Schema we validate ourselves with the hand-rolled {@link validate} — one schema, no zod, no second
 * validator.
 *
 * CRITICAL: on the stdio transport the SDK owns stdout for JSON-RPC framing — writing anything else to it
 * corrupts the stream. So this module logs ONLY to stderr, and never `console.log`s. Tools run in-process
 * against the same pure orchestrators the CLI uses; a handler that throws is turned into an `isError`
 * result (a real failure), while a valid-but-negative read like "drift detected" returns normally.
 */

import { readFileSync } from "node:fs";
import type { CallToolResult, ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import { requireOptional } from "../optionalDep.js";
import { validate } from "../jsonSchema.js";
import { loadConfig } from "../config.js";
import { gateTools } from "./gate.js";
import { ALL_TOOLS } from "./tools.js";
import type { McpTool, McpToolResult } from "./types.js";

/** The install hint shown when the optional MCP SDK isn't present. */
const SDK_INSTALL_HINT = "npm i @modelcontextprotocol/sdk";

/**
 * Lazy-load the SDK pieces we use, mapping a missing package to an actionable message. We deliberately use
 * the low-level `Server` (not the high-level `McpServer`): `McpServer` requires zod schemas per tool,
 * whereas `Server` lets each tool advertise a raw JSON Schema we validate with our own {@link validate} —
 * which is the whole reason Launch needs no second validator. The deprecation hint steers casual users to
 * `McpServer`; this is exactly the "advanced use case" it exempts.
 */
async function loadSdk(): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- low-level Server is the intended API here (see above)
  Server: typeof import("@modelcontextprotocol/sdk/server/index.js").Server;
  StdioServerTransport: typeof import("@modelcontextprotocol/sdk/server/stdio.js").StdioServerTransport;
  schemas: typeof import("@modelcontextprotocol/sdk/types.js");
}> {
  return requireOptional("launch mcp (the MCP server)", SDK_INSTALL_HINT, async () => {
    const [server, stdio, schemas] = await Promise.all([
      import("@modelcontextprotocol/sdk/server/index.js"),
      import("@modelcontextprotocol/sdk/server/stdio.js"),
      import("@modelcontextprotocol/sdk/types.js"),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- low-level Server is the intended API here (see above)
    return { Server: server.Server, StdioServerTransport: stdio.StdioServerTransport, schemas };
  });
}

/**
 * Run one tool: validate `args` against its schema, dispatch, and convert a throw into an `isError` result.
 * Exported so a test can grade the validate→dispatch→`isError` boundary without standing up a transport.
 */
export async function dispatch(tool: McpTool, args: Record<string, unknown>): Promise<McpToolResult> {
  const violations = validate(args, tool.inputSchema);
  if (violations.length > 0) {
    const detail = violations.map((violation) => `${violation.path || "(root)"}: ${violation.message}`).join("; ");
    return { content: [{ type: "text", text: `Invalid arguments for ${tool.name}: ${detail}` }], isError: true };
  }
  try {
    return await tool.handler(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

/** The package version, read from the manifest, used as the server's advertised version. */
function serverVersion(): string {
  try {
    const manifest: unknown = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
    return typeof manifest === "object" &&
      manifest !== null &&
      "version" in manifest &&
      typeof manifest.version === "string"
      ? manifest.version
      : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Build and connect the MCP server over stdio, exposing only the tools the operator's `launch.config.ts`
 * enables (read-only by default). Resolves once the transport is connected and runs until the client
 * disconnects (the process then exits). The `tools` parameter defaults to the full registry across every
 * tier (the gate filters it down to the enabled tiers) but is injectable so a test can drive the server
 * with a fake tool set.
 */
export async function startMcpServer(tools: readonly McpTool[] = ALL_TOOLS): Promise<void> {
  const { config } = await loadConfig();
  const enabled = gateTools(tools, config);
  const byName = new Map(enabled.map((tool) => [tool.name, tool]));

  const { Server, StdioServerTransport, schemas } = await loadSdk();
  const server = new Server({ name: "launch", version: serverVersion() }, { capabilities: { tools: {} } });

  // The SDK's protocol result types carry an open index signature (`[x: string]: unknown`) that our
  // intentionally closed domain types omit, so a structurally-valid value isn't *assignable* across this
  // boundary without one cast each (`as unknown as`) — the only place Launch's no-`as` rule is waived, and
  // only to assert the protocol shape we already conform to.
  const listResult = {
    tools: enabled.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
  } as unknown as ListToolsResult;
  server.setRequestHandler(schemas.ListToolsRequestSchema, () => listResult);

  server.setRequestHandler(schemas.CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name);
    const result: McpToolResult = tool
      ? await dispatch(tool, request.params.arguments ?? {})
      : { content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }], isError: true };
    return result as unknown as CallToolResult;
  });

  process.stderr.write(`launch mcp: ${enabled.length} tool(s) exposed (${enabled.map((t) => t.name).join(", ")})\n`);
  await server.connect(new StdioServerTransport());
}
