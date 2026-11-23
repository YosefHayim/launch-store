import { describe, expect, it } from 'vitest';
import { Command, type CommandOption } from '../../command.ts';
import { registerAuditCommand } from './audit.ts';

function describeRegisterAuditCommand() {
  function attachesATopLevelAuditCommandWithItsPiece() {
    const program = new Command();

    registerAuditCommand(program);

    function isAuditCommand(command: Command) {
      return command.name() == 'audit';
    }

    const audit = program.commands.find(isAuditCommand);

    expect(audit).toBeDefined();

    function readLong(option: CommandOption) {
      return option.long;
    }

    const options = audit?.options.map(readLong);

    expect(options).toContain('--app');
    expect(options).toContain('--json');
  }

  it(
    'attaches a top-level `audit` command with its options',
    attachesATopLevelAuditCommandWithItsPiece,
  );
}

describe('registerAuditCommand', describeRegisterAuditCommand);
