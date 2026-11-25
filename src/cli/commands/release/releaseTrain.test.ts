import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerReleaseTrainCommand } from './releaseTrain.js';

describe('registerReleaseTrainCommand', () => {
  it('registers the release-train actions and selectors', () => {
    const program = new Command();
    registerReleaseTrainCommand(program);
    const releaseTrainCommand = program.commands.find(
      (registeredCommand) => registeredCommand.name() === 'release-train',
    );
    expect(releaseTrainCommand).toBeDefined();
    expect(releaseTrainCommand?.registeredArguments.map((argument) => argument.name())).toEqual([
      'action',
      'id',
    ]);
    expect(releaseTrainCommand?.options.map((commandOption) => commandOption.long)).toEqual(
      expect.arrayContaining([
        '--app',
        '--profile',
        '--platform',
        '--no-ota',
        '--hold',
        '--channel',
        '--runtime-version',
        '--watch',
        '--json',
        '--env',
        '--include-local',
      ]),
    );
  });
});
