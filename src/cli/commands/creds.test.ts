/**
 * Tests for the `creds` command's pure helpers. {@link isInDiscoveryDir} gates the offer to delete an
 * imported key's plaintext source (issue #4): only keys sitting in a scanned "dumping ground" are
 * offered for removal, never a key the user deliberately placed elsewhere. The option-surface tests
 * pin the `--app` selector added in #261 (sub-problem #3) — `creds setup --app <name>` used to error
 * with `unknown option '--app'`, so this catches its removal.
 */

import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { isInDiscoveryDir, registerCredsCommand } from './creds.js';

/** The registered `creds` command from a fresh program, for option-surface assertions. */
function credsCommand() {
  const program = new Command();
  registerCredsCommand(program);
  const creds = program.commands.find((command) => command.name() === 'creds');
  expect(creds).toBeDefined();
  return creds;
}

describe('isInDiscoveryDir — only offer to delete keys from scanned dumping grounds (issue #4)', () => {
  it('matches a key sitting directly in ~/Downloads', () => {
    expect(isInDiscoveryDir(join(homedir(), 'Downloads', 'AuthKey_ABC123.p8'))).toBe(true);
  });

  it('matches a service-account JSON in the current working directory', () => {
    expect(isInDiscoveryDir(join(process.cwd(), 'service-account.json'))).toBe(true);
  });

  it('leaves a deliberately-placed key (outside the scanned dirs) untouched', () => {
    expect(isInDiscoveryDir(join(homedir(), 'vault', 'AuthKey_ABC123.p8'))).toBe(false);
  });

  it('does not match a key one level deeper than a discovery dir', () => {
    expect(isInDiscoveryDir(join(homedir(), 'Downloads', 'keys', 'AuthKey.p8'))).toBe(false);
  });
});

describe('registerCredsCommand — non-interactive app selector (#261)', () => {
  it('defines --app so `creds setup --app <name>` no longer errors with "unknown option"', () => {
    const longs = credsCommand()?.options.map((option) => option.long);
    expect(longs).toContain('--app');
  });

  it('keeps --account and --yes alongside --app for a fully non-interactive setup', () => {
    const longs = credsCommand()?.options.map((option) => option.long);
    expect(longs).toContain('--account');
    expect(longs).toContain('--yes');
  });
});
