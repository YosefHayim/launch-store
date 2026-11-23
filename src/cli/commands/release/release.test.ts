import { Command, type CommandOption } from '@/cli/command.js';
import { describe, expect, it } from 'vitest';
import { registerReleaseCommand } from './release.ts';
function describeRegisterReleaseCommandThePieceFlag() {
  function exposesPieceOffByDefault() {
    const program = new Command();

    registerReleaseCommand(program);

    function isReleaseCommand(command: Command) {
      return command.name() == 'release';
    }

    const releaseCommand = program.commands.find(isReleaseCommand);

    function isJsonOption(option: CommandOption) {
      return option.long == '--json';
    }

    const jsonOption = releaseCommand?.options.find(isJsonOption);

    expect(jsonOption).toBeDefined();
    expect(jsonOption?.defaultValue).toBe(false);
  }

  it('exposes --json, off by default', exposesPieceOffByDefault);
}

describe('registerReleaseCommand - the --json flag', describeRegisterReleaseCommandThePieceFlag);
