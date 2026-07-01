/**
 * The capability gate — which tools `launch mcp` actually exposes, given the operator's config.
 *
 * The whole safety model of the MCP server is least privilege: `launch.config.ts` opts into capability
 * tiers (`mcp: { capabilities: [...] }`), and the server registers ONLY the tools whose tier is enabled.
 * Absent or empty config means `["read"]` — read-only — so merely wiring an agent to Launch can never
 * mutate a store until the operator widens the tiers on purpose. Tiers do not nest: `["write"]` does not
 * imply `["read"]`, so the usual posture is the explicit `["read", "write"]`. This function is the single
 * place that decision is made, so both the server and a test grade it identically.
 */

import type { LaunchConfig, McpCapability, McpTool } from '../types.js';

/** The default when `mcp.capabilities` is absent or empty: read-only, the safest exposure. */
const DEFAULT_CAPABILITIES: readonly McpCapability[] = ['read'];

/**
 * Resolve the enabled capability tiers from a config: the declared list when non-empty, else the
 * read-only default. A declared `[]` is treated as "unset" — there is no use for a server that exposes no
 * tools, so it falls back to `read` rather than serving nothing.
 */
export function enabledCapabilities(config: LaunchConfig): readonly McpCapability[] {
  const declared = config.mcp?.capabilities;
  return declared && declared.length > 0 ? declared : DEFAULT_CAPABILITIES;
}

/**
 * Filter a tool list down to those the config enables, preserving the registry's display order. The
 * server calls this with {@link import("./tools.js").ALL_TOOLS} — every tier's registry (read, dryRun,
 * write, dangerous) passes through this one gate, so the capability opt-in stays in a single place.
 */
export function gateTools(tools: readonly McpTool[], config: LaunchConfig): McpTool[] {
  const enabled = new Set(enabledCapabilities(config));
  return tools.filter((tool) => enabled.has(tool.capability));
}
