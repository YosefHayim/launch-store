import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clientConfigPath,
  installServer,
  LAUNCH_SERVER_ENTRY,
  mergeServerEntry,
  type InstalledMcpServer,
  type McpClient,
} from './install.ts';

describe('mergeServerEntry', () => {
  it('adds Launch to an empty document', () => {
    const mergedConfig = mergeServerEntry({}, 'launch', LAUNCH_SERVER_ENTRY);

    expect(mergedConfig.changed).toBe(true);
    expect(mergedConfig.config).toEqual({
      mcpServers: { launch: { command: 'launch', args: ['mcp'] } },
    });
  });

  it('preserves existing servers and unrelated keys', () => {
    const existingConfig = {
      theme: 'dark',
      mcpServers: { other: { command: 'other-bin', args: [] } },
    };

    const mergeServer = mergeServerEntry(existingConfig, 'launch', LAUNCH_SERVER_ENTRY);
    expect(mergeServer.config).toEqual({
      theme: 'dark',
      mcpServers: {
        other: { command: 'other-bin', args: [] },
        launch: { command: 'launch', args: ['mcp'] },
      },
    });
  });

  it('does not rewrite an identical entry', () => {
    const existingConfig = {
      mcpServers: { launch: { command: 'launch', args: ['mcp'] } },
    };
    const mergedConfig = mergeServerEntry(existingConfig, 'launch', LAUNCH_SERVER_ENTRY);

    expect(mergedConfig.changed).toBe(false);
    expect(mergedConfig.config).toBe(existingConfig);
  });

  it('replaces a malformed mcpServers field', () => {
    const mergeServer = mergeServerEntry({ mcpServers: 'broken' }, 'launch', LAUNCH_SERVER_ENTRY);
    expect(mergeServer).toEqual({
      changed: true,
      config: { mcpServers: { launch: { command: 'launch', args: ['mcp'] } } },
    });
  });
});

describe('clientConfigPath', () => {
  it('uses project-local paths for Claude Code and Cursor', () => {
    const clientPath = clientConfigPath('claude-code', '/repo', '/home/me', 'macos');
    const joinedPath = join('/repo', '.mcp.json');
    expect(clientPath).toBe(joinedPath);
    const mcpPath = join('/repo', '.cursor', 'mcp.json');
    expect(clientConfigPath('cursor', '/repo', '/home/me', 'macos')).toBe(mcpPath);
  });

  it('uses the operating-system application config for Claude Desktop', () => {
    const clientPath = clientConfigPath('claude-desktop', '/repo', '/home/me', 'macos');
    const joinedPath = join(
      '/home/me',
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    );
    expect(clientPath).toBe(joinedPath);
    expect(clientConfigPath('claude-desktop', '/repo', '/home/me', 'windows')).toBe(
      join('/home/me', 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
    );
  });
});

describe('installServer', () => {
  let workingDirectory: string;

  beforeEach(() => {
    const systemTemporaryDirectory = tmpdir();
    const launchMcpInstallPath = join(systemTemporaryDirectory, 'launch-mcp-install-');
    workingDirectory = mkdtempSync(launchMcpInstallPath);
  });

  afterEach(() => {
    rmSync(workingDirectory, { recursive: true, force: true });
  });

  function runInstall(client: McpClient): Promise<InstalledMcpServer> {
    return installServer(client, workingDirectory, workingDirectory, 'macos');
  }

  it('writes .mcp.json and reports the change', async () => {
    const installedServer = await runInstall('claude-code');

    expect(installedServer.changed).toBe(true);
    const joinedPath = join(workingDirectory, '.mcp.json');
    expect(installedServer.path).toBe(joinedPath);

    const loadedFile = readFileSync(installedServer.path, 'utf8');
    const configDocument: unknown = JSON.parse(loadedFile);

    expect(configDocument).toEqual({
      mcpServers: { launch: { command: 'launch', args: ['mcp'] } },
    });
  });

  it('is idempotent once configured', async () => {
    await runInstall('claude-code');

    const install = runInstall('claude-code');
    await expect(install).resolves.toMatchObject({ changed: false });
  });

  it('preserves other configured servers', async () => {
    const joinedPath = join(workingDirectory, '.mcp.json');
    const serialized = JSON.stringify({ mcpServers: { other: { command: 'x', args: [] } } });
    writeFileSync(joinedPath, serialized);
    await runInstall('claude-code');

    const loadedFile = readFileSync(join(workingDirectory, '.mcp.json'), 'utf8');
    const configDocument: unknown = JSON.parse(loadedFile);

    expect(configDocument).toMatchObject({
      mcpServers: {
        other: { command: 'x', args: [] },
        launch: { command: 'launch', args: ['mcp'] },
      },
    });
  });
});
