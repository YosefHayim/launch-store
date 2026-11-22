import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { HostOs } from '../types/remote.ts';

export type McpClient = 'claude-code' | 'cursor' | 'claude-desktop';

type McpServerEntry = Readonly<{
  command: string;
  args: string[];
}>;

export const LAUNCH_SERVER_ENTRY: McpServerEntry = { command: 'launch', args: ['mcp'] };

type MergeResult = Readonly<{
  config: Record<string, unknown>;
  changed: boolean;
}>;

export type InstalledMcpServer = Readonly<{
  path: string;
  changed: boolean;
}>;

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  return Array.isArray(candidate) == false;
}

function desktopConfigPath(homeDirectory: string, operatingSystem: HostOs): string {
  if (operatingSystem == 'windows') {
    return join(homeDirectory, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
  }

  return join(
    homeDirectory,
    'Library',
    'Application Support',
    'Claude',
    'claude_desktop_config.json',
  );
}

/** Resolve one client's config path from explicit runtime facts. */
export function clientConfigPath(
  client: McpClient,
  workingDirectory: string,
  homeDirectory: string,
  operatingSystem: HostOs,
): string {
  switch (client) {
    case 'claude-code':
      return join(workingDirectory, '.mcp.json');
    case 'cursor':
      return join(workingDirectory, '.cursor', 'mcp.json');
    case 'claude-desktop':
      return desktopConfigPath(homeDirectory, operatingSystem);
  }
}

function readServers(candidate: unknown): Record<string, unknown> {
  if (isRecord(candidate)) {
    return candidate;
  }

  return {};
}

function collectStringArguments(args: readonly unknown[]): string[] | null {
  const stringArgs: string[] = [];

  for (const argument of args) {
    if (typeof argument != 'string') {
      return null;
    }

    stringArgs.push(argument);
  }

  return stringArgs;
}

function readStringArguments(candidate: unknown): string[] | null {
  if (Array.isArray(candidate)) {
    return collectStringArguments(candidate);
  }

  return null;
}

function readServerEntryFromRecord(record: Record<string, unknown>): McpServerEntry | null {
  const command = record['command'];
  const stringArgs = readStringArguments(record['args']);

  if (typeof command != 'string') {
    return null;
  }

  if (stringArgs == null) {
    return null;
  }

  return { command, args: stringArgs };
}

function readServerEntry(candidate: unknown): McpServerEntry | null {
  if (isRecord(candidate)) {
    return readServerEntryFromRecord(candidate);
  }

  return null;
}

function isSameServerEntry(currentEntry: McpServerEntry, serverEntry: McpServerEntry): boolean {
  const isSameCommand = currentEntry.command == serverEntry.command;

  if (isSameCommand == false) {
    return false;
  }

  return JSON.stringify(currentEntry.args) == JSON.stringify(serverEntry.args);
}

/** Merge Launch into mcpServers while preserving unrelated client settings. */
export function mergeServerEntry(
  existingConfig: Record<string, unknown>,
  serverName: string,
  serverEntry: McpServerEntry,
): MergeResult {
  const configuredServers = readServers(existingConfig['mcpServers']);
  const currentEntry = readServerEntry(configuredServers[serverName]);

  if (currentEntry != null) {
    const isUnchanged = isSameServerEntry(currentEntry, serverEntry);

    if (isUnchanged) {
      return { config: existingConfig, changed: false };
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
}

function decodeConfigDocument(configDocumentJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(configDocumentJson);

    if (isRecord(parsed)) {
      return parsed;
    }
  } catch (error) {
    const isMalformed = error != null;

    if (isMalformed) {
      return {};
    }
  }

  return {};
}

/** Read a client config, treating absent or malformed content as an empty document. */
async function readClientConfig(configPath: string): Promise<Record<string, unknown>> {
  try {
    const configDocumentJson = await readFile(configPath, 'utf8');

    return decodeConfigDocument(configDocumentJson);
  } catch (error) {
    const isUnreadable = error != null;

    if (isUnreadable) {
      return {};
    }

    return {};
  }
}

/** Install Launch into one MCP client config idempotently. */
export async function installServer(
  client: McpClient,
  workingDirectory: string,
  homeDirectory: string,
  operatingSystem: HostOs,
  serverEntry: McpServerEntry = LAUNCH_SERVER_ENTRY,
): Promise<InstalledMcpServer> {
  const configPath = clientConfigPath(client, workingDirectory, homeDirectory, operatingSystem);
  const existingConfig = await readClientConfig(configPath);
  const mergedConfig = mergeServerEntry(existingConfig, 'launch', serverEntry);

  if (mergedConfig.changed) {
    const directoryPath = dirname(configPath);
    const configDocumentJson = `${JSON.stringify(mergedConfig.config, null, 2)}\n`;

    await mkdir(directoryPath, { recursive: true });
    await writeFile(configPath, configDocumentJson);
  }

  return { path: configPath, changed: mergedConfig.changed };
}
