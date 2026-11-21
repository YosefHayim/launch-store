import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerCredsCommand } from './creds.js';

const credsCommand = () => {
  const program = new Command();
  registerCredsCommand(program);
  const creds = program.commands.find((command) => command.name() === 'creds');
  expect(creds).toBeDefined();
  return creds;
};

describe('registerCredsCommand - non-interactive app selector (#261)', () => {
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
