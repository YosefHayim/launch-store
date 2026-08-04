import { FileSystem } from '@effect/platform';
import { Cause, Effect, Runtime, Schema } from 'effect';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/config.js';
import { validate } from '../config/jsonSchema.js';
import { errorMessage } from '../services/errorMessage.js';
import { requireOptional } from '../services/optionalDep.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import type { McpTool, McpToolResult } from '../types/mcp.js';
import { gateTools } from './gate.js';
import { ALL_TOOLS, type McpToolRequirements } from './tools.js';

const SDK_INSTALL_HINT = 'pnpm add @modelcontextprotocol/sdk';
const PackageManifestSchema = Schema.Struct({ version: Schema.String });

type McpSdk = Readonly<{
  readonly Server: typeof import('@modelcontextprotocol/sdk/server/index.js').Server;
  readonly StdioServerTransport: typeof import('@modelcontextprotocol/sdk/server/stdio.js').StdioServerTransport;
  readonly schemas: typeof import('@modelcontextprotocol/sdk/types.js');
}>;

/** Lazily load the optional MCP transport SDK. */
const loadSdk = (): Effect.Effect<McpSdk, unknown> =>
  requireOptional('launch mcp (the MCP server)', SDK_INSTALL_HINT, () =>
    Effect.all(
      {
        serverModule: Effect.tryPromise(() => import('@modelcontextprotocol/sdk/server/index.js')),
        stdioModule: Effect.tryPromise(() => import('@modelcontextprotocol/sdk/server/stdio.js')),
        schemas: Effect.tryPromise(() => import('@modelcontextprotocol/sdk/types.js')),
      },
      { concurrency: 'unbounded' },
    ).pipe(
      Effect.map(({ serverModule, stdioModule, schemas }) => ({
        Server: serverModule.Server,
        StdioServerTransport: stdioModule.StdioServerTransport,
        schemas,
      })),
    ),
  );

/** Dispatch one validated MCP tool call and encode failures as protocol error content. */
export const dispatch = <Requirements>(
  tool: McpTool<Requirements>,
  argumentsRecord: Record<string, unknown>,
): Effect.Effect<McpToolResult, never, Requirements> => {
  const violations = validate(argumentsRecord, tool.inputSchema);
  if (violations.length > 0) {
    const violationText = violations
      .map((violation) => {
        let violationPath = violation.path;
        if (violationPath.length === 0) violationPath = '(root)';
        return `${violationPath}: ${violation.message}`;
      })
      .join('; ');
    return Effect.succeed({
      content: [
        {
          type: 'text',
          text: `Invalid arguments for ${tool.name}: ${violationText}`,
        },
      ],
      isError: true,
    });
  }
  return Effect.suspend(() => tool.handler(argumentsRecord)).pipe(
    Effect.catchAllCause((failureCause) => {
      const failureOutput: McpToolResult = {
        content: [{ type: 'text', text: errorMessage(Cause.squash(failureCause)) }],
        isError: true,
      };
      return Effect.succeed(failureOutput);
    }),
  );
};

/** Read the package version advertised by the MCP server. */
const serverVersion = (): Effect.Effect<string, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const manifestPath = fileURLToPath(new URL('../../../package.json', import.meta.url));
    return yield* fileSystem.readFileString(manifestPath).pipe(
      Effect.flatMap(Schema.decodeUnknown(Schema.parseJson(PackageManifestSchema))),
      Effect.map((packageManifest) => packageManifest.version),
      Effect.orElseSucceed(() => '0.0.0'),
    );
  });

/** Connect the configured MCP tool registry to the stdio transport. */
export const startMcpServer = (
  tools: readonly McpTool<McpToolRequirements>[] = ALL_TOOLS,
): Effect.Effect<void, unknown, McpToolRequirements | FileSystem.FileSystem | LaunchPathsService> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const loadedConfig = yield* loadConfig(launchPaths.workingDirectory);
    const enabledTools = gateTools(tools, loadedConfig.config);
    const toolsByName = new Map(enabledTools.map((tool) => [tool.name, tool]));
    const { Server, StdioServerTransport, schemas } = yield* loadSdk();
    const version = yield* serverVersion();
    const toolRuntime = yield* Effect.runtime<McpToolRequirements>();
    const server = new Server({ name: 'launch', version }, { capabilities: { tools: {} } });
    const advertisedTools = {
      tools: enabledTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
    server.setRequestHandler(schemas.ListToolsRequestSchema, () => advertisedTools);
    server.setRequestHandler(schemas.CallToolRequestSchema, (toolRequest) =>
      Runtime.runPromise(toolRuntime)(
        Effect.gen(function* () {
          const selectedTool = toolsByName.get(toolRequest.params.name);
          if (selectedTool === undefined) {
            const unknownToolOutput: McpToolResult = {
              content: [{ type: 'text', text: `Unknown tool: ${toolRequest.params.name}` }],
              isError: true,
            };
            return unknownToolOutput;
          }
          let toolArguments: Record<string, unknown> = {};
          if (toolRequest.params.arguments !== undefined) {
            toolArguments = toolRequest.params.arguments;
          }
          return yield* dispatch(selectedTool, toolArguments);
        }),
      ),
    );
    yield* Effect.tryPromise(() => server.connect(new StdioServerTransport()));
  });
