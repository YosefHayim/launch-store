import { FileSystem, Path } from '@effect/platform';
import { Effect, Schema } from 'effect';
import type { HostOs } from '../types/remote.js';

const McpConfigDocumentSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });
const McpServersSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });
const McpServerEntrySchema = Schema.Struct({
  command: Schema.String,
  args: Schema.Array(Schema.String),
});

export type McpClient = 'claude-code' | 'cursor' | 'claude-desktop';

export type McpServerEntry = Readonly<{
  readonly command: string;
  readonly args: string[];
}>;

export const LAUNCH_SERVER_ENTRY: McpServerEntry = { command: 'launch', args: ['mcp'] };

export type MergeResult = Readonly<{
  readonly config: Record<string, unknown>;
  readonly changed: boolean;
}>;

export type InstalledMcpServer = Readonly<{
  readonly path: string;
  readonly changed: boolean;
}>;

/** Resolve one client's config path from explicit runtime facts. */
export const clientConfigPath = (
  client: McpClient,
  workingDirectory: string,
  homeDirectory: string,
  operatingSystem: HostOs,
  pathService: Path.Path,
): string => {
  switch (client) {
    case 'claude-code':
      return pathService.join(workingDirectory, '.mcp.json');
    case 'cursor':
      return pathService.join(workingDirectory, '.cursor', 'mcp.json');
    case 'claude-desktop':
      if (operatingSystem === 'windows') {
        return pathService.join(
          homeDirectory,
          'AppData',
          'Roaming',
          'Claude',
          'claude_desktop_config.json',
        );
      }
      return pathService.join(
        homeDirectory,
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json',
      );
  }
};

/** Merge Launch into mcpServers while preserving unrelated client settings. */
export const mergeServerEntry = (
  existingConfig: Record<string, unknown>,
  serverName: string,
  serverEntry: McpServerEntry,
): MergeResult => {
  const decodedServers = Schema.decodeUnknownEither(McpServersSchema)(existingConfig['mcpServers']);
  let configuredServers: Record<string, unknown> = {};
  if (decodedServers._tag === 'Right') configuredServers = decodedServers.right;
  const decodedCurrent = Schema.decodeUnknownEither(McpServerEntrySchema)(
    configuredServers[serverName],
  );
  if (decodedCurrent._tag === 'Right') {
    const currentEntry = decodedCurrent.right;
    if (currentEntry.command === serverEntry.command) {
      if (JSON.stringify(currentEntry.args) === JSON.stringify(serverEntry.args)) {
        return { config: existingConfig, changed: false };
      }
    }
  }
  return {
    config: {
      ...existingConfig,
      mcpServers: {
        ...configuredServers,
        [serverName]: { command: serverEntry.command, args: [...serverEntry.args] },
      },
    },
    changed: true,
  };
};

/** Read a client config, treating absent or malformed content as an empty document. */
const readClientConfig = (
  configPath: string,
): Effect.Effect<Record<string, unknown>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const configText = yield* fileSystem
      .readFileString(configPath)
      .pipe(Effect.orElseSucceed(() => '{}'));
    const decodedConfig = yield* Schema.decode(Schema.parseJson(McpConfigDocumentSchema))(
      configText,
    ).pipe(Effect.either);
    if (decodedConfig._tag === 'Left') return {};
    return decodedConfig.right;
  });

/** Install Launch into one MCP client config idempotently. */
export const installServer = (
  client: McpClient,
  workingDirectory: string,
  homeDirectory: string,
  operatingSystem: HostOs,
  serverEntry: McpServerEntry = LAUNCH_SERVER_ENTRY,
): Effect.Effect<InstalledMcpServer, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const configPath = clientConfigPath(
      client,
      workingDirectory,
      homeDirectory,
      operatingSystem,
      pathService,
    );
    const existingConfig = yield* readClientConfig(configPath);
    const mergedConfig = mergeServerEntry(existingConfig, 'launch', serverEntry);
    if (mergedConfig.changed) {
      yield* fileSystem.makeDirectory(pathService.dirname(configPath), { recursive: true });
      yield* fileSystem.writeFileString(
        configPath,
        `${JSON.stringify(mergedConfig.config, null, 2)}\n`,
      );
    }
    return { path: configPath, changed: mergedConfig.changed };
  });
