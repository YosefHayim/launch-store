import type { Effect } from 'effect';
import type { JsonSchema } from '../config/jsonSchema.js';
import type { McpCapability } from './storeSurface.js';
/**
 * One block of an MCP tool result. Launch only ever emits `text` (a tool returns its structured report as
 * pretty-printed JSON), but the field is kept as a discriminated shape so it matches the protocol's
 * content-block union and could carry other kinds later without a breaking change.
 */
export type McpTextContent = Readonly<{
  type: 'text';
  text: string;
}>;
/**
 * What a tool handler returns: the content blocks the agent sees, plus an `isError` flag. Per the protocol
 * (and the locked design) `isError` marks a genuine failure the agent should treat as an error - NOT a
 * valid-but-negative finding like "drift detected", which is a successful read. Handlers return success
 * results; the server turns a thrown error into an `isError` result centrally, so handlers never set it.
 */
export type McpToolResult = Readonly<{
  content: readonly McpTextContent[];
  isError?: boolean;
}>;
/**
 * The raw input schema a tool advertises. It is the draft-07 object subset the protocol requires
 * (`{ type: "object", properties?, required? }`) expressed as our own {@link JsonSchema}, so the SAME
 * value both advertises the tool (via `tools/list`) and validates incoming arguments through the
 * hand-rolled {@link import("../config/jsonSchema.js").validate} - one schema, no zod, no second validator.
 */
export type McpInputSchema = JsonSchema &
  Readonly<{
    type: 'object';
  }>;
/**
 * One MCP tool: a stable name, a one-line description the agent reads, the capability tier that gates it,
 * the input schema, and the handler. The handler receives the already-validated argument object (the
 * server runs {@link import("../config/jsonSchema.js").validate} against {@link inputSchema} first) and returns a
 * structured {@link McpToolResult}. A handler may throw on a real failure - the server catches it and
 * surfaces an `isError` result - but returns normally for any valid read, even a negative one.
 */
export type McpTool<Requirements = never> = {
  name: string;
  description: string;
  capability: McpCapability;
  inputSchema: McpInputSchema;
  handler(args: Record<string, unknown>): Effect.Effect<McpToolResult, unknown, Requirements>;
};
