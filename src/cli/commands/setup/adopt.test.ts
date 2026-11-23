import { Command } from '../../command.ts';
import { describe, expect, it } from 'vitest';
import { registerAdoptCommand } from './adopt.ts';
function describeRegisterAdoptCommand() {
  function registersAdoptWithDryRunAndConfirmationFlags() {
    const program = new Command();

    registerAdoptCommand(program);

    function findCommand(command: Command) {
      return command.name() == 'adopt';
    }

    const adoptCommand = program.commands.find(findCommand);

    expect(adoptCommand).toBeDefined();

    if (adoptCommand == null) return;

    expect(adoptCommand.opts()['all']).toBe(false);
    expect(adoptCommand.opts()['dryRun']).toBe(false);
    expect(adoptCommand.opts()['yes']).toBe(false);
  }

  it(
    'registers adopt with dry-run and confirmation flags',
    registersAdoptWithDryRunAndConfirmationFlags,
  );
}

describe('registerAdoptCommand', describeRegisterAdoptCommand);
