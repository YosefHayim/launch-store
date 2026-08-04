import { FileSystem, Path } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, type Logger } from '../services/logger.js';
import { detectHostOperatingSystem } from '../services/os.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import { installServer, type McpClient } from './install.js';
import { startMcpServer } from './server.js';
import type { McpToolRequirements } from './tools.js';

const ALL_CLIENTS: readonly McpClient[] = ['claude-code', 'cursor', 'claude-desktop'];

const CLIENT_LABELS: Record<McpClient, string> = {
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  'claude-desktop': 'Claude Desktop',
};

export const McpCommandInputSchema = Schema.Union(
  Schema.Struct({ operation: Schema.Literal('serve') }),
  Schema.Struct({
    operation: Schema.Literal('install'),
    client: Schema.optional(Schema.String),
  }),
);

export type McpCommandInput = Schema.Schema.Type<typeof McpCommandInputSchema>;

export type McpCommandFailure = Readonly<{
  readonly _tag: 'McpCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeMcpCommandFailure = Data.tagged<McpCommandFailure>('McpCommandFailure');

type McpCommandRequirements =
  | FileSystem.FileSystem
  | LaunchPathsService
  | Logger
  | McpToolRequirements
  | Path.Path;

/** Parse a requested MCP client name. */
const parseClient = (clientName: string): Effect.Effect<McpClient, McpCommandFailure> => {
  const matchedClient = ALL_CLIENTS.find((client) => client === clientName);
  if (matchedClient !== undefined) return Effect.succeed(matchedClient);
  return Effect.fail(
    makeMcpCommandFailure({
      operation: 'select MCP client',
      message: `Unknown client "${clientName}". Use ${ALL_CLIENTS.join(', ')}.`,
    }),
  );
};

/** Detect project MCP clients from their conventional marker paths. */
const detectClients = (
  workingDirectory: string,
): Effect.Effect<McpClient[], unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const claudeConfigExists = yield* fileSystem.exists(
      pathService.join(workingDirectory, '.mcp.json'),
    );
    const claudeDirectoryExists = yield* fileSystem.exists(
      pathService.join(workingDirectory, '.claude'),
    );
    const cursorDirectoryExists = yield* fileSystem.exists(
      pathService.join(workingDirectory, '.cursor'),
    );
    const detectedClients: McpClient[] = [];
    if (claudeConfigExists) detectedClients.push('claude-code');
    else if (claudeDirectoryExists) detectedClients.push('claude-code');
    if (cursorDirectoryExists) detectedClients.push('cursor');
    return detectedClients;
  });

/** Install the Launch MCP server into an explicit or auto-detected client. */
const installMcpServer = (
  commandInput: Extract<McpCommandInput, { operation: 'install' }>,
): Effect.Effect<void, unknown, McpCommandRequirements> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    let targetClients: McpClient[];
    if (commandInput.client !== undefined) {
      targetClients = [yield* parseClient(commandInput.client)];
    } else {
      targetClients = yield* detectClients(launchPaths.workingDirectory);
    }
    const logger = yield* createLogger(false);
    if (targetClients.length === 0) {
      yield* logger.skip(
        'No MCP client detected here. Pass --client claude-code|cursor|claude-desktop to install explicitly.',
      );
      return;
    }
    const operatingSystem = yield* detectHostOperatingSystem;
    for (const client of targetClients) {
      const installedServer = yield* installServer(
        client,
        launchPaths.workingDirectory,
        launchPaths.homeDirectory,
        operatingSystem,
      );
      if (installedServer.changed) {
        yield* logger.step(CLIENT_LABELS[client], `wired \`launch\` into ${installedServer.path}`);
      } else {
        yield* logger.step(CLIENT_LABELS[client], `already configured (${installedServer.path})`);
      }
    }
    yield* logger.gap();
    yield* logger.note(
      'Restart the client to pick up the server, then ask its agent to run a Launch tool such as `plan`.',
    );
  });

/** Run the MCP stdio server or install its client configuration. */
export const mcpCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, McpCommandFailure, McpCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(McpCommandInputSchema)(rawCommandInput);
    switch (commandInput.operation) {
      case 'serve':
        return yield* startMcpServer();
      case 'install':
        return yield* installMcpServer(commandInput);
    }
  }).pipe(
    Effect.mapError((cause) =>
      makeMcpCommandFailure({
        operation: 'run MCP command',
        message: errorMessage(cause),
        cause,
      }),
    ),
  );
