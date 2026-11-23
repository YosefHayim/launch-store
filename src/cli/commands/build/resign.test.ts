import { Command, type CommandOption } from '@/cli/command.js';
import { describe, expect, it } from 'vitest';
import { registerResignCommand } from './resign.ts';

function describeRegisterResignCommand() {
  function attachesBuildResignWithTheDocumentedOptionSurface() {
    const program = new Command();

    registerResignCommand(program);

    function isBuildResignCommand(registeredCommand: Command) {
      return registeredCommand.name() == 'build:resign';
    }

    const resignCommand = program.commands.find(isBuildResignCommand);

    expect(resignCommand).toBeDefined();

    if (resignCommand == null) return;

    function readLong(option: CommandOption) {
      return option.long;
    }

    const optionFlags = resignCommand.options.map(readLong);

    expect(optionFlags).toContain('--id');
    expect(optionFlags).toContain('--latest');
    expect(optionFlags).toContain('--app');
    expect(optionFlags).toContain('--account');
    expect(optionFlags).toContain('--output');
    expect(optionFlags).toContain('--dry-run');
  }

  it(
    'attaches build:resign with the documented option surface',
    attachesBuildResignWithTheDocumentedOptionSurface,
  );
}

describe('registerResignCommand', describeRegisterResignCommand);
