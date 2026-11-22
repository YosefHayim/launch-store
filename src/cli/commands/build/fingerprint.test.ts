import { Command } from '../../command.ts';
import { describe, expect, it } from 'vitest';
import { registerFingerprintCommand } from './fingerprint.ts';

describe('registerFingerprintCommand', () => {
  it('registers the fingerprint command and its selectors', () => {
    const program = new Command();
    registerFingerprintCommand(program);
    const fingerprintCommand = program.commands.find(
      (registeredCommand) => registeredCommand.name() == 'fingerprint',
    );
    expect(fingerprintCommand).toBeDefined();
    expect(fingerprintCommand?.options.map((commandOption) => commandOption.long)).toEqual(
      expect.arrayContaining(['--app', '--json']),
    );
  });
});
