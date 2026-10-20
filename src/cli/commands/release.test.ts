import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerReleaseCommand, shouldNudgeRelease } from './release.js';

describe('release CLI re-export', () => {
  it('keeps shouldNudgeRelease available for thin CLI consumers', () => {
    expect(shouldNudgeRelease({ clean: true })).toBe(false);
    expect(shouldNudgeRelease({ clean: false })).toBe(true);
  });
});

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
