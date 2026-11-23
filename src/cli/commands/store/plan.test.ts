import { Command, type CommandOption } from '../../command.ts';
import { describe, expect, it } from 'vitest';
import { registerPlanCommand } from './plan.ts';

function registeredPlanCommands(): readonly Command[] {
  const program = new Command();
  registerPlanCommand(program);
  return program.commands;
}
function describeRegisterPlanCommand() {
  function keepsThePlanCommandAndDriftAliasWithOptionalSurfaceArguments() {
    const planCommands = registeredPlanCommands();

    function mapRegisteredCommand(registeredCommand: Command) {
      return registeredCommand.name();
    }

    expect(planCommands.map(mapRegisteredCommand)).toEqual(['plan', 'drift']);

    for (const registeredCommand of planCommands) {
      expect(registeredCommand.registeredArguments).toHaveLength(1);
      expect(registeredCommand.registeredArguments[0]?.required).toBe(false);
    }
  }

  it(
    'keeps the plan command and drift alias with optional surface arguments',
    keepsThePlanCommandAndDriftAliasWithOptionalSurfaceArguments,
  );

  function preservesAppCheckAndJSONPieceOnTheirPublicCommands() {
    const planCommands = registeredPlanCommands();

    function findRegisteredCommand(registeredCommand: Command) {
      return registeredCommand.name() == 'plan';
    }

    const planCommand = planCommands.find(findRegisteredCommand);

    function findRegisteredCommand2(registeredCommand: Command) {
      return registeredCommand.name() == 'drift';
    }

    const driftCommand = planCommands.find(findRegisteredCommand2);

    function readLong(commandOption: CommandOption) {
      return commandOption.long;
    }

    expect(planCommand?.options.map(readLong)).toEqual(['--app', '--check', '--json']);

    function readLong2(commandOption: CommandOption) {
      return commandOption.long;
    }

    expect(driftCommand?.options.map(readLong2)).toEqual(['--app', '--json']);
  }

  it(
    'preserves app, check, and JSON options on their public commands',
    preservesAppCheckAndJSONPieceOnTheirPublicCommands,
  );
}

describe('registerPlanCommand', describeRegisterPlanCommand);
