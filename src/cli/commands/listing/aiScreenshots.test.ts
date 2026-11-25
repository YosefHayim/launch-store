import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerAiScreenshotsCommand } from './aiScreenshots.js';

describe('registerAiScreenshotsCommand', () => {
  it('registers screenshots under the shared ai group with the public flags', () => {
    const program = new Command();
    registerAiScreenshotsCommand(program);
    const aiCommand = program.commands.find(
      (registeredCommand) => registeredCommand.name() === 'ai',
    );
    const screenshotsCommand = aiCommand?.commands.find(
      (registeredCommand) => registeredCommand.name() === 'screenshots',
    );
    expect(screenshotsCommand?.options.map((commandOption) => commandOption.long)).toEqual([
      '--app',
      '--brief',
      '--locale',
      '--platform',
      '--in',
      '--captions',
      '--device-types',
      '--out',
      '--genshot-bin',
      '--dry-run',
      '--yes',
    ]);
    const platformOption = screenshotsCommand?.options.find(
      (commandOption) => commandOption.long === '--platform',
    );
    expect(platformOption?.defaultValue).toBe('all');
  });
});
