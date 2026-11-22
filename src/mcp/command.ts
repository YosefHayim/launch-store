import { join } from 'node:path';
import { pathExists } from '../path-exists.js';
import { errorMessage } from '../services/platform/errorMessage.js';
import { createLogger } from '../services/platform/logger.js';
import { detectHostOperatingSystem } from '../services/platform/os.js';
import { readLaunchDirectories } from '../services/platform/paths.js';
import { installServer, type McpClient } from './install.js';
import { startMcpServer } from './server.js';

const ALL_CLIENTS: readonly McpClient[] = ['claude-code', 'cursor', 'claude-desktop'];

const CLIENT_LABELS: Record<McpClient, string> = {
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  'claude-desktop': 'Claude Desktop',
};

type McpCommandInput = { operation: 'serve' } | { operation: 'install'; client?: string };

type McpCommandFailure = Readonly<{
  _tag: 'McpCommandFailure';
  operation: string;
  message: string;
  cause?: unknown;
}>;

function makeMcpCommandFailure(fields: {
  operation: string;
  message: string;
  cause?: unknown;
}): McpCommandFailure {
  return { _tag: 'McpCommandFailure', ...fields };
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  return Array.isArray(candidate) == false;
}

/** Parse a requested MCP client name. */
function parseClient(clientName: string): McpClient {
  function isNamedClient(client: McpClient): boolean {
    return client == clientName;
  }

  const listedClient = ALL_CLIENTS.find(isNamedClient);

  if (listedClient != null) {
    return listedClient;
  }

  throw makeMcpCommandFailure({
    operation: 'select MCP client',
    message: `Unknown client "${clientName}". Use ${ALL_CLIENTS.join(', ')}.`,
  });
}

function readInstallClient(commandRecord: Record<string, unknown>): string | undefined {
  const isClientAbsent = 'client' in commandRecord == false;

  if (isClientAbsent) {
    return undefined;
  }

  const clientField = commandRecord['client'];

  if (clientField == null) {
    return undefined;
  }

  if (typeof clientField != 'string') {
    throw makeMcpCommandFailure({
      operation: 'run MCP command',
      message: 'MCP client must be a string.',
    });
  }

  return clientField;
}

function readMcpCommandRecord(commandRecord: Record<string, unknown>): McpCommandInput {
  const operation = commandRecord['operation'];

  if (operation == 'serve') {
    return { operation: 'serve' };
  }

  if (operation == 'install') {
    const client = readInstallClient(commandRecord);

    if (client == null) {
      return { operation: 'install' };
    }

    return { operation: 'install', client };
  }

  throw makeMcpCommandFailure({
    operation: 'run MCP command',
    message: 'MCP command operation must be serve or install.',
  });
}

function readMcpCommandInput(rawCommandInput: unknown): McpCommandInput {
  if (isRecord(rawCommandInput)) {
    return readMcpCommandRecord(rawCommandInput);
  }

  throw makeMcpCommandFailure({
    operation: 'run MCP command',
    message: 'MCP command input must be an object.',
  });
}

/** Detect project MCP clients from their conventional marker paths. */
async function detectClients(workingDirectory: string): Promise<McpClient[]> {
  const claudeConfigPath = join(workingDirectory, '.mcp.json');
  const claudeDirectoryPath = join(workingDirectory, '.claude');
  const cursorDirectoryPath = join(workingDirectory, '.cursor');
  const claudeConfigExists = pathExists(claudeConfigPath);
  const claudeDirectoryExists = pathExists(claudeDirectoryPath);
  const cursorDirectoryExists = pathExists(cursorDirectoryPath);
  const markerChecks = await Promise.all([
    claudeConfigExists,
    claudeDirectoryExists,
    cursorDirectoryExists,
  ]);
  const hasClaudeConfig = markerChecks[0] == true;
  const hasClaudeDirectory = markerChecks[1] == true;
  const hasCursorDirectory = markerChecks[2] == true;
  const detectedClients: McpClient[] = [];
  let hasClaudeCode = hasClaudeConfig;

  if (hasClaudeCode == false) {
    hasClaudeCode = hasClaudeDirectory;
  }

  if (hasClaudeCode) {
    detectedClients.push('claude-code');
  }

  if (hasCursorDirectory) {
    detectedClients.push('cursor');
  }

  return detectedClients;
}

async function installClients(targetClients: readonly McpClient[]): Promise<void> {
  const logger = createLogger(false);
  const hasNoClients = targetClients.length == 0;

  if (hasNoClients) {
    logger.skip(
      'No MCP client detected here. Pass --client claude-code|cursor|claude-desktop to install explicitly.',
    );

    return;
  }

  const launchDirectories = readLaunchDirectories();
  const operatingSystem = detectHostOperatingSystem();

  for (const client of targetClients) {
    const installedServer = await installServer(
      client,
      launchDirectories.workingDirectory,
      launchDirectories.homeDirectory,
      operatingSystem,
    );
    const clientLabel = CLIENT_LABELS[client];

    if (installedServer.changed) {
      logger.step(clientLabel, `wired \`launch\` into ${installedServer.path}`);
      continue;
    }

    logger.step(clientLabel, `already configured (${installedServer.path})`);
  }

  logger.gap();
  logger.note(
    'Restart the client to pick up the server, then ask its agent to run a Launch tool such as `plan`.',
  );
}

/** Install the Launch MCP server into an explicit or auto-detected client. */
async function installMcpServer(commandInput: {
  operation: 'install';
  client?: string;
}): Promise<void> {
  const requestedClient = commandInput.client;

  if (requestedClient != null) {
    await installClients([parseClient(requestedClient)]);

    return;
  }

  const launchDirectories = readLaunchDirectories();
  const detectedClients = await detectClients(launchDirectories.workingDirectory);

  await installClients(detectedClients);
}

/** Run the MCP stdio server or install its client configuration. */
export async function mcpCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = readMcpCommandInput(rawCommandInput);

    switch (commandInput.operation) {
      case 'serve':
        await startMcpServer();
        return;
      case 'install':
        await installMcpServer(commandInput);
        return;
    }
  } catch (cause) {
    throw makeMcpCommandFailure({
      operation: 'run MCP command',
      message: errorMessage(cause),
      cause,
    });
  }
}
