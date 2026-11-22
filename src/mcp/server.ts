import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import { findLaunchConfig, loadConfig } from '../config/config.ts';
import { validate, type SchemaViolation } from '../config/json-schema.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { requireOptional } from '../services/platform/optional-dep.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import type { McpTool, McpToolResult } from '../types/mcp.ts';
import { gateTools } from './gate.ts';
import { STATS_TOOLS } from './stats-tools.ts';
import { ALL_TOOLS } from './tools.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

type McpServerConstructor = typeof import('@modelcontextprotocol/sdk/server/index.js').Server;
type McpStdioTransport =
  typeof import('@modelcontextprotocol/sdk/server/stdio.js').StdioServerTransport;
type McpSchemas = typeof import('@modelcontextprotocol/sdk/types.js');

type McpSdk = Readonly<{
  Server: McpServerConstructor;
  StdioServerTransport: McpStdioTransport;
  schemas: McpSchemas;
}>;

async function loadMcpSdk(): Promise<McpSdk> {
  const serverModule = await import('@modelcontextprotocol/sdk/server/index.js');
  const stdioModule = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const schemas = await import('@modelcontextprotocol/sdk/types.js');

  return {
    Server: serverModule.Server,
    StdioServerTransport: stdioModule.StdioServerTransport,
    schemas,
  };
}

/** Lazily load the optional MCP transport SDK. */
async function loadSdk(): Promise<McpSdk> {
  return requireOptional(
    'launch mcp (the MCP server)',
    'pnpm add @modelcontextprotocol/sdk',
    loadMcpSdk,
  );
}

function describeViolation(violation: SchemaViolation): string {
  let violationPath = violation.path;
  const isRoot = violationPath.length == 0;

  if (isRoot) {
    violationPath = '(root)';
  }

  return `${violationPath}: ${violation.message}`;
}

/** Dispatch one validated MCP tool call and encode failures as protocol error content. */
export async function dispatch(
  tool: McpTool,
  argumentsRecord: Record<string, unknown>,
): Promise<McpToolResult> {
  const violations = validate(argumentsRecord, tool.inputSchema);
  const hasViolations = violations.length > 0;

  if (hasViolations) {
    const violationSummary = violations.map(describeViolation).join('; ');

    return {
      content: [
        {
          type: 'text',
          text: `Invalid arguments for ${tool.name}: ${violationSummary}`,
        },
      ],
      isError: true,
    };
  }

  try {
    return await tool.handler(argumentsRecord);
  } catch (cause) {
    return {
      content: [{ type: 'text', text: errorMessage(cause) }],
      isError: true,
    };
  }
}

function readPackageVersion(parsedManifest: unknown): string | null {
  const parsedManifestObject = readPlainObject(parsedManifest);

  if (parsedManifestObject != null) {
    const version = parsedManifestObject['version'];

    if (typeof version == 'string') {
      return version;
    }
  }

  return null;
}

/** Read the package version advertised by the MCP server. */
async function serverVersion(): Promise<string> {
  const manifestPath = fileURLToPath(new URL('../../package.json', import.meta.url));

  try {
    const manifestJson = await readFile(manifestPath, 'utf8');
    const parsedManifest: unknown = JSON.parse(manifestJson);
    const version = readPackageVersion(parsedManifest);

    if (version != null) {
      return version;
    }
  } catch (error) {
    const isUnreadable = error != null;

    if (isUnreadable) {
      return '0.0.0';
    }
  }

  return '0.0.0';
}

/**
 * Tools served for this folder. With no launch.config, only the stats tools are served, so one
 * user-scope registration works everywhere. A config that exists but cannot load still fails.
 */
export async function pickServedTools(
  tools: readonly McpTool[],
  workingDirectory: string,
): Promise<readonly McpTool[]> {
  const foundConfig = await findLaunchConfig(workingDirectory);

  if (foundConfig == null) {
    return STATS_TOOLS;
  }

  const loadedConfiguration = await loadConfig(workingDirectory);

  return [...gateTools(tools, loadedConfiguration.config), ...STATS_TOOLS];
}

function toolByName(tool: McpTool): readonly [string, McpTool] {
  return [tool.name, tool];
}

function advertiseTool(tool: McpTool): {
  name: string;
  description: string;
  inputSchema: McpTool['inputSchema'];
} {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}

/** Connect the configured MCP tool registry to the stdio transport. */
export async function startMcpServer(tools: readonly McpTool[] = ALL_TOOLS): Promise<void> {
  const launchDirectories = readLaunchDirectories();
  const enabledTools = await pickServedTools(tools, launchDirectories.workingDirectory);
  const toolsByName = new Map(enabledTools.map(toolByName));
  const loadedSdk = await loadSdk();
  const version = await serverVersion();
  const Server = loadedSdk.Server;
  const StdioServerTransport = loadedSdk.StdioServerTransport;
  const schemas = loadedSdk.schemas;
  const server = new Server({ name: 'launch', version }, { capabilities: { tools: {} } });
  const advertisedTools = {
    tools: enabledTools.map(advertiseTool),
  };

  function listTools(): typeof advertisedTools {
    return advertisedTools;
  }

  async function callTool(toolRequest: CallToolRequest): Promise<McpToolResult> {
    const selectedTool = toolsByName.get(toolRequest.params.name);

    if (selectedTool == null) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolRequest.params.name}` }],
        isError: true,
      };
    }

    let toolArguments: Record<string, unknown> = {};

    if (toolRequest.params.arguments != null) {
      toolArguments = toolRequest.params.arguments;
    }

    return dispatch(selectedTool, toolArguments);
  }

  server.setRequestHandler(schemas.ListToolsRequestSchema, listTools);
  server.setRequestHandler(schemas.CallToolRequestSchema, callTool);
  await server.connect(new StdioServerTransport());
}
