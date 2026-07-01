/**
 * Shared vocabulary for the MCP layer — the `launch mcp` server that exposes Launch's read-only
 * introspection to AI agents over the Model Context Protocol (JSON-RPC on stdio).
 *
 * The design mirrors the rest of the read family (plan / audit / snapshot / doctor): a tool owns no
 * logic, it just calls the same pure core orchestrator the CLI calls and returns the structured object —
 * in-process, never by self-shelling. These types describe the MCP *mechanism* (a tool's identity, its
 * capability tier, its hand-written input schema, and its handler's result). The capability tier
 * ({@link McpCapability}, in `./storeSurface.js` because the config schema generator must see it) is the
 * gate: the server registers only tools whose tier the operator enabled in `launch.config.ts`, so an
 * agent can never reach a mutation the operator didn't opt into. The result/argument helpers that build
 * these shapes (`jsonResult`, `optionalString`) are runtime logic and live in `core/mcp/tools.ts`.
 */

import type { JsonSchema } from '../jsonSchema.js';
import type { McpCapability } from './storeSurface.js';

/**
 * One block of an MCP tool result. Launch only ever emits `text` (a tool returns its structured report as
 * pretty-printed JSON), but the field is kept as a discriminated shape so it matches the protocol's
 * content-block union and could carry other kinds later without a breaking change.
 */
export interface McpTextContent {
  type: 'text';
  /** The block's text — for Launch, the JSON-serialized report. */
  text: string;
}

/**
 * What a tool handler returns: the content blocks the agent sees, plus an `isError` flag. Per the protocol
 * (and the locked design) `isError` marks a genuine failure the agent should treat as an error — NOT a
 * valid-but-negative finding like "drift detected", which is a successful read. Handlers return success
 * results; the server turns a thrown error into an `isError` result centrally, so handlers never set it.
 */
export interface McpToolResult {
  content: McpTextContent[];
  /** `true` only for a real failure (a throw); omitted for any successful read, including negative ones. */
  isError?: boolean;
}

/**
 * The raw input schema a tool advertises. It is the draft-07 object subset the protocol requires
 * (`{ type: "object", properties?, required? }`) expressed as our own {@link JsonSchema}, so the SAME
 * value both advertises the tool (via `tools/list`) and validates incoming arguments through the
 * hand-rolled {@link import("../jsonSchema.js").validate} — one schema, no zod, no second validator.
 */
export interface McpInputSchema extends JsonSchema {
  type: 'object';
}

/**
 * One MCP tool: a stable name, a one-line description the agent reads, the capability tier that gates it,
 * the input schema, and the handler. The handler receives the already-validated argument object (the
 * server runs {@link import("../jsonSchema.js").validate} against {@link inputSchema} first) and returns a
 * structured {@link McpToolResult}. A handler may throw on a real failure — the server catches it and
 * surfaces an `isError` result — but returns normally for any valid read, even a negative one.
 */
export interface McpTool {
  /** Stable snake_case id the agent calls, e.g. `store_doctor` (kept distinct from the CLI's spacing). */
  name: string;
  /** One-line capability summary shown in the agent's tool list. */
  description: string;
  /** The tier that must be enabled in `launch.config.ts` for this tool to be registered. */
  capability: McpCapability;
  /** The argument schema — advertised to the agent and used to validate each call. */
  inputSchema: McpInputSchema;
  /** Run the tool against already-validated `args`; resolve with the structured result. */
  handler(args: Record<string, unknown>): Promise<McpToolResult>;
}
