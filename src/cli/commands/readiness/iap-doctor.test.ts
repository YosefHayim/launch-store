import { describe, expect, it } from 'vitest';
import { Command } from '../../command.ts';
import { registerIapCommand } from './iap-doctor.ts';
describe('registerIapCommand', () => {
  it('attaches an `iap` group with a `doctor` subcommand and its options', () => {
    const program = new Command();
    registerIapCommand(program);
    const iap = program.commands.find((command) => command.name() == 'iap');
    expect(iap).toBeDefined();
    const doctor = iap?.commands.find((command) => command.name() == 'doctor');
    expect(doctor).toBeDefined();
    const options = doctor?.options.map((option) => option.long);
    expect(options).toContain('--app');
    expect(options).toContain('--json');
  });
});
