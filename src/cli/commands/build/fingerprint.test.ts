import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerFingerprintCommand } from './fingerprint.js';

describe('registerFingerprintCommand', () => {
  it('registers the fingerprint command and its selectors', () => {
    const program = new Command();
    registerFingerprintCommand(program);
    const fingerprintCommand = program.commands.find(
      (registeredCommand) => registeredCommand.name() === 'fingerprint',
    );
    expect(fingerprintCommand).toBeDefined();
    expect(fingerprintCommand?.options.map((commandOption) => commandOption.long)).toEqual(
      expect.arrayContaining(['--app', '--json']),
    );
  });
});
