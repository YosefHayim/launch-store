import type { Command } from '../../../command.ts';
import {
  type TeamInviteInput,
  type TeamListInput,
  teamCommandProgram,
  type TeamRemoveInput,
} from './team-command.ts';
import { runCliProgram } from '../../../run-cli-program.ts';

type InviteOptions = Readonly<{
  readonly first: string;
  readonly last: string;
  readonly role: string;
  readonly provisioning: boolean;
  readonly yes: boolean;
}>;

/** Attach the team command group. */
export function registerTeamCommand(program: Command): void {
  const teamCommand = program
    .command('team')
    .description('read and manage the App Store Connect team (members & invitations) from the CLI');

  function runList(commandOptions: Omit<TeamListInput, 'operation'>) {
    const teamProgram = teamCommandProgram({ operation: 'list', json: commandOptions.json });
    return runCliProgram(teamProgram);
  }

  teamCommand
    .command('list')
    .description('list team members and pending invitations')
    .option('--json', 'output machine-readable JSON', false)
    .action(runList);

  function runInvite(email: string, commandOptions: InviteOptions) {
    const commandInput: TeamInviteInput = {
      operation: 'invite',
      email,
      first: commandOptions.first,
      last: commandOptions.last,
      role: commandOptions.role,
      provisioning: commandOptions.provisioning,
      yes: commandOptions.yes,
    };
    const teamProgram = teamCommandProgram(commandInput);

    return runCliProgram(teamProgram);
  }

  teamCommand
    .command('invite')
    .description('invite a new team member by email')
    .argument('<email>', "the invitee's Apple ID email")
    .requiredOption('--first <name>', "the invitee's first name")
    .requiredOption('--last <name>', "the invitee's last name")
    .requiredOption('--role <roles>', 'comma-separated roles (e.g. DEVELOPER,APP_MANAGER)')
    .option('--provisioning', 'allow the member to create signing assets', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runInvite);

  function runRemove(email: string, commandOptions: Readonly<{ yes: boolean }>) {
    const commandInput: TeamRemoveInput = {
      operation: 'remove',
      email,
      yes: commandOptions.yes,
    };
    const teamProgram = teamCommandProgram(commandInput);

    return runCliProgram(teamProgram);
  }

  teamCommand
    .command('remove')
    .description('remove a team member or cancel a pending invitation, by email')
    .argument('<email>', "the member's / invitee's email")
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runRemove);
}
