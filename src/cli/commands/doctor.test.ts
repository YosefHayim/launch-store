import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { registerDoctorCommand } from './doctor.js';

describe('registerDoctorCommand', () => {
  it('attaches a `doctor` command with platform, app, fix, yes, and json options', () => {
    const program = new Command();
    registerDoctorCommand(program);

    const doctor = program.commands.find((command) => command.name() === 'doctor');
    expect(doctor).toBeDefined();

    const options = doctor?.options.map((option) => option.long);
    expect(options).toContain('--platform');
    expect(options).toContain('--app');
    expect(options).toContain('--fix');
    expect(options).toContain('--yes');
    expect(options).toContain('--json');
  });
});
