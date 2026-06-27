import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { registerAuditCommand } from './audit.js';

describe('registerAuditCommand', () => {
  it('attaches a top-level `audit` command with its options', () => {
    const program = new Command();
    registerAuditCommand(program);

    const audit = program.commands.find((command) => command.name() === 'audit');
    expect(audit).toBeDefined();

    const options = audit?.options.map((option) => option.long);
    expect(options).toContain('--app');
    expect(options).toContain('--json');
  });
});
