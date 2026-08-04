import { FileSystem, Path } from '@effect/platform';
import { Effect, Layer } from 'effect';
import { clientConfigPath, installServer } from '../mcp/install.js';
import { detectHostOperatingSystem } from '../services/os.js';
import { LaunchPaths } from '../services/paths.js';
import {
  AgentsCommandService,
  type AgentsCommandFailure,
  makeAgentsCommandFailure,
} from './command.js';

/** Map an MCP adapter failure into the agents command channel. */
const liveFailure = (operation: string, cause: unknown): AgentsCommandFailure => {
  let message = `${operation} failed.`;
  if (cause instanceof Error) message = cause.message;
  return makeAgentsCommandFailure({ operation, message, cause });
};

/** Live MCP adapter used by the agents command. */
export const AgentsCommandServiceLive = Layer.effect(
  AgentsCommandService,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const launchPaths = yield* LaunchPaths;
    const operatingSystem = yield* detectHostOperatingSystem;
    return {
      installMcpServer: (mcpClient, repositoryPath) =>
        installServer(mcpClient, repositoryPath, launchPaths.homeDirectory, operatingSystem).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, pathService),
          Effect.mapError((cause) => liveFailure('install the Launch MCP server', cause)),
        ),
      mcpConfigPath: (mcpClient, repositoryPath) =>
        clientConfigPath(
          mcpClient,
          repositoryPath,
          launchPaths.homeDirectory,
          operatingSystem,
          pathService,
        ),
    };
  }),
);
