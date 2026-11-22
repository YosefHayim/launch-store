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

    expect(mergeServerEntry(existingConfig, 'launch', LAUNCH_SERVER_ENTRY).config).toEqual({
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
    expect(mergeServerEntry({ mcpServers: 'broken' }, 'launch', LAUNCH_SERVER_ENTRY)).toEqual({
      changed: true,
      config: { mcpServers: { launch: { command: 'launch', args: ['mcp'] } } },
    });
  });
});

describe('clientConfigPath', () => {
  it('uses project-local paths for Claude Code and Cursor', () => {
    expect(clientConfigPath('claude-code', '/repo', '/home/me', 'macos')).toBe(
      join('/repo', '.mcp.json'),
    );
    expect(clientConfigPath('cursor', '/repo', '/home/me', 'macos')).toBe(
      join('/repo', '.cursor', 'mcp.json'),
    );
  });

  it('uses the operating-system application config for Claude Desktop', () => {
    expect(clientConfigPath('claude-desktop', '/repo', '/home/me', 'macos')).toBe(
      join('/home/me', 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    );
    expect(clientConfigPath('claude-desktop', '/repo', '/home/me', 'windows')).toBe(
      join('/home/me', 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
    );
  });
});

describe('installServer', () => {
  let workingDirectory: string;

  beforeEach(() => {
    workingDirectory = mkdtempSync(join(tmpdir(), 'launch-mcp-install-'));
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
    expect(installedServer.path).toBe(join(workingDirectory, '.mcp.json'));

    const configDocument: unknown = JSON.parse(readFileSync(installedServer.path, 'utf8'));

    expect(configDocument).toEqual({
      mcpServers: { launch: { command: 'launch', args: ['mcp'] } },
    });
  });

  it('is idempotent once configured', async () => {
    await runInstall('claude-code');

    await expect(runInstall('claude-code')).resolves.toMatchObject({ changed: false });
  });

  it('preserves other configured servers', async () => {
    writeFileSync(
      join(workingDirectory, '.mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'x', args: [] } } }),
    );
    await runInstall('claude-code');

    const configDocument: unknown = JSON.parse(
      readFileSync(join(workingDirectory, '.mcp.json'), 'utf8'),
    );

    expect(configDocument).toMatchObject({
      mcpServers: {
        other: { command: 'x', args: [] },
        launch: { command: 'launch', args: ['mcp'] },
      },
    });
  });
});
