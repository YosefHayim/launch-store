import { Command } from '../../command.ts';
import { describe, expect, it } from 'vitest';
import { registerCloudCommand } from './cloud.ts';

describe('registerCloudCommand', () => {
  it('keeps the cloud action argument and explicit teardown confirmation flag', () => {
    const program = new Command();
    registerCloudCommand(program);
    const cloudCommand = program.commands.find(
      (registeredCommand) => registeredCommand.name() === 'cloud',
    );
    expect(cloudCommand).toBeDefined();
    expect(cloudCommand?.registeredArguments[0]?.defaultValue).toBe('status');
    expect(cloudCommand?.options.map((commandOption) => commandOption.long)).toContain('--yes');
  });
});
