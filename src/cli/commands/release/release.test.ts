import { Command } from '@/cli/command.js';
import { describe, expect, it } from 'vitest';
import { registerReleaseCommand } from './release.js';

describe('registerReleaseCommand - the --json flag', () => {
  it('exposes --json, off by default', () => {
    const program = new Command();
    registerReleaseCommand(program);
    const releaseCommand = program.commands.find((command) => command.name() === 'release');
    const jsonOption = releaseCommand?.options.find((option) => option.long === '--json');
    expect(jsonOption).toBeDefined();
    expect(jsonOption?.defaultValue).toBe(false);
  });
});
