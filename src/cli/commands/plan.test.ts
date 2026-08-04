import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerPlanCommand } from './plan.js';

const registeredPlanCommands = (): readonly Command[] => {
  const program = new Command();
  registerPlanCommand(program);
  return program.commands;
};

describe('registerPlanCommand', () => {
  it('keeps the plan command and drift alias with optional surface arguments', () => {
    const planCommands = registeredPlanCommands();
    expect(planCommands.map((registeredCommand) => registeredCommand.name())).toEqual([
      'plan',
      'drift',
    ]);
    for (const registeredCommand of planCommands) {
      expect(registeredCommand.registeredArguments).toHaveLength(1);
      expect(registeredCommand.registeredArguments[0]?.required).toBe(false);
    }
  });

  it('preserves app, check, and JSON options on their public commands', () => {
    const planCommands = registeredPlanCommands();
    const planCommand = planCommands.find(
      (registeredCommand) => registeredCommand.name() === 'plan',
    );
    const driftCommand = planCommands.find(
      (registeredCommand) => registeredCommand.name() === 'drift',
    );
    expect(planCommand?.options.map((commandOption) => commandOption.long)).toEqual([
      '--app',
      '--check',
      '--json',
    ]);
    expect(driftCommand?.options.map((commandOption) => commandOption.long)).toEqual([
      '--app',
      '--json',
    ]);
  });
});
