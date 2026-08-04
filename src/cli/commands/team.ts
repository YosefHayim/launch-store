import type { Command } from 'commander';
import {
  type TeamInviteInput,
  type TeamListInput,
  teamCommandProgram,
  type TeamRemoveInput,
} from '@core/store/teamCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type InviteOptions = Readonly<{
  readonly first: string;
  readonly last: string;
  readonly role: string;
  readonly provisioning: boolean;
  readonly yes: boolean;
}>;

/** Attach the team command group. */
export const registerTeamCommand = (program: Command): void => {
  const teamCommand = program
    .command('team')
    .description('read and manage the App Store Connect team (members & invitations) from the CLI');
  teamCommand
    .command('list')
    .description('list team members and pending invitations')
    .option('--json', 'output machine-readable JSON', false)
    .action((commandOptions: Omit<TeamListInput, 'operation'>) =>
      runCliProgram(teamCommandProgram({ operation: 'list', json: commandOptions.json })),
    );
  teamCommand
    .command('invite')
    .description('invite a new team member by email')
    .argument('<email>', "the invitee's Apple ID email")
    .requiredOption('--first <name>', "the invitee's first name")
    .requiredOption('--last <name>', "the invitee's last name")
    .requiredOption('--role <roles>', 'comma-separated roles (e.g. DEVELOPER,APP_MANAGER)')
    .option('--provisioning', 'allow the member to create signing assets', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((email: string, commandOptions: InviteOptions) => {
      const commandInput: TeamInviteInput = {
        operation: 'invite',
        email,
        first: commandOptions.first,
        last: commandOptions.last,
        role: commandOptions.role,
        provisioning: commandOptions.provisioning,
        yes: commandOptions.yes,
      };
      return runCliProgram(teamCommandProgram(commandInput));
    });
  teamCommand
    .command('remove')
    .description('remove a team member or cancel a pending invitation, by email')
    .argument('<email>', "the member's / invitee's email")
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((email: string, commandOptions: Readonly<{ yes: boolean }>) => {
      const commandInput: TeamRemoveInput = {
        operation: 'remove',
        email,
        yes: commandOptions.yes,
      };
      return runCliProgram(teamCommandProgram(commandInput));
    });
};
