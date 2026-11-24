// Lists, invites, and removes members of the App Store Connect team.

import { createLogger } from '../services/platform/logger.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import { checkTerminalIsInteractive } from '../services/platform/progress.ts';
import type { UserInvitationResource, UserResource } from '../types/apple/users-and-access.ts';
import { loadActiveAppleStore } from './apple-store-command.ts';
import { getTeam, inviteTeamMember, removeTeamMember, type Team } from './team.ts';
import { hasMessage } from '../services/platform/error-message.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import type { Command } from '../cli/command.ts';
import { runCliProgram } from '../cli/run-cli-program.ts';

export type TeamListInput = Readonly<{ operation: 'list'; json: boolean }>;

export type TeamInviteInput = Readonly<{
  operation: 'invite';
  email: string;
  first: string;
  last: string;
  role: string;
  provisioning: boolean;
  yes: boolean;
}>;

export type TeamRemoveInput = Readonly<{ operation: 'remove'; email: string; yes: boolean }>;

type TeamCommandInput = TeamListInput | TeamInviteInput | TeamRemoveInput;

function readText(record: Record<string, unknown>, fieldName: string): string {
  const field = record[fieldName];
  const isText = typeof field == 'string';

  if (isText == false) {
    throw new Error(`Expected ${fieldName} to be a string.`);
  }

  return field;
}

function readFlag(record: Record<string, unknown>, fieldName: string): boolean {
  const field = record[fieldName];
  const isFlag = typeof field == 'boolean';

  if (isFlag == false) {
    throw new Error(`Expected ${fieldName} to be a boolean.`);
  }

  return field;
}

/** Decode one team command. */
export function TeamCommandInputSchema(rawCommandInput: unknown): TeamCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Team command input must be an object.');
  }

  const operation = rawCommandInputObject['operation'];

  if (operation == 'list') {
    return { operation: 'list', json: readFlag(rawCommandInputObject, 'json') };
  }

  if (operation == 'invite') {
    return {
      operation: 'invite',
      email: readText(rawCommandInputObject, 'email'),
      first: readText(rawCommandInputObject, 'first'),
      last: readText(rawCommandInputObject, 'last'),
      role: readText(rawCommandInputObject, 'role'),
      provisioning: readFlag(rawCommandInputObject, 'provisioning'),
      yes: readFlag(rawCommandInputObject, 'yes'),
    };
  }

  if (operation == 'remove') {
    return {
      operation: 'remove',
      email: readText(rawCommandInputObject, 'email'),
      yes: readFlag(rawCommandInputObject, 'yes'),
    };
  }

  throw new Error('Unknown team command.');
}

/** Convert a dependency failure into an Error. */
function teamCommandFailure(operation: TeamCommandInput['operation'], cause: unknown): never {
  const causeText = typeof cause == 'string' ? cause : '';
  const isBlankCauseText = causeText.length == 0;

  if (isBlankCauseText == false) {
    throw new Error(causeText, { cause });
  }

  const causeHasMessage = hasMessage(cause);

  if (causeHasMessage) {
    throw new Error(cause.message, { cause });
  }

  throw new Error(`Team ${operation} failed.`, { cause });
}

/** Join a person's available first and last names. */
function teamMemberFullName(person: { firstName?: string; lastName?: string }): string {
  const nameParts: string[] = [];
  const firstName = person.firstName;

  const hasFirstName = firstName != null;

  if (hasFirstName) {
    nameParts.push(firstName);
  }

  const lastName = person.lastName;

  const hasLastName = lastName != null;

  if (hasLastName) {
    nameParts.push(lastName);
  }

  return nameParts.join(' ');
}

/** Render one accepted team member. */
function renderTeamMember(teamMember: UserResource): string {
  const memberDetails = [teamMember.username];
  const memberName = teamMemberFullName(teamMember);

  const hasName = memberName.length > 0;

  if (hasName) {
    memberDetails.push(memberName);
  }

  memberDetails.push(`[${teamMember.roles.join(', ')}]`);

  return memberDetails.join('  ');
}

/** Render one pending team invitation. */
function renderTeamInvitation(pendingInvitation: UserInvitationResource): string {
  const invitationDetails = [pendingInvitation.email];
  const invitationName = teamMemberFullName(pendingInvitation);

  const hasName = invitationName.length > 0;

  if (hasName) {
    invitationDetails.push(invitationName);
  }

  invitationDetails.push(`[${pendingInvitation.roles.join(', ')}]`);

  const hasExpiration = pendingInvitation.expirationDate != null;

  if (hasExpiration) {
    invitationDetails.push(`expires ${pendingInvitation.expirationDate.slice(0, 10)}`);
  }

  return invitationDetails.join('  ');
}

/** Render accepted members and invitations as one readable block. */
export function renderTeam(currentTeam: Team): string {
  const teamLines = [
    `Team - ${currentTeam.members.length} member(s), ${currentTeam.invitations.length} pending invitation(s)`,
  ];

  const hasMembers = currentTeam.members.length > 0;

  if (hasMembers) {
    teamLines.push('', 'Members:');

    for (const teamMember of currentTeam.members) {
      teamLines.push(`  ${renderTeamMember(teamMember)}`);
    }
  }

  const hasInvitations = currentTeam.invitations.length > 0;

  if (hasInvitations) {
    teamLines.push('', 'Pending invitations:');

    for (const pendingInvitation of currentTeam.invitations) {
      const teamInvitation = renderTeamInvitation(pendingInvitation);
      teamLines.push(`  ${teamInvitation}`);
    }
  }

  return teamLines.join('\n');
}

/** Confirm a team access change. Confirmation failures stay tagged as invite until the caller wraps them. */
async function confirmTeamWrite(confirmationMessage: string, assumeYes: boolean): Promise<boolean> {
  const isConfirmed = assumeYes == true;

  if (isConfirmed) {
    return true;
  }

  const terminalIsInteractive = checkTerminalIsInteractive();

  const needsATerminal = terminalIsInteractive == false;

  if (needsATerminal) {
    throw new Error(
      'Refusing to change team access without confirmation. Re-run with --yes (non-interactive).',
      { cause: 'confirmation-required' },
    );
  }

  let confirmed = false;

  try {
    confirmed = await new LaunchPrompt().confirm(confirmationMessage);
  } catch (cause) {
    throw teamCommandFailure('invite', cause);
  }

  if (confirmed) {
    return true;
  }

  new LaunchPrompt().cancel('Aborted - no team changes made.');

  return false;
}

/** List the App Store Connect team. */
async function listTeam(commandInput: TeamListInput): Promise<void> {
  try {
    const appleStore = await loadActiveAppleStore();
    const currentTeam = await getTeam(appleStore);
    const logger = createLogger(false);

    const wantsJson = commandInput.json == true;

    if (wantsJson) {
      const serialized = JSON.stringify(currentTeam, null, 2);
      logger.line(serialized);
      return;
    }

    const team = renderTeam(currentTeam);

    logger.line(team);
  } catch (cause) {
    throw teamCommandFailure('list', cause);
  }
}

/** Confirm and invite one App Store Connect team member. */
async function inviteTeam(commandInput: TeamInviteInput): Promise<void> {
  try {
    const confirmed = await confirmTeamWrite(
      `Invite ${commandInput.email} to the team (sends them an email)?`,
      commandInput.yes,
    );

    const declined = confirmed == false;

    if (declined) {
      return;
    }

    const appleStore = await loadActiveAppleStore();
    const createdInvitation = await inviteTeamMember(appleStore, {
      email: commandInput.email,
      firstName: commandInput.first,
      lastName: commandInput.last,
      roles: commandInput.role.split(','),
      provisioningAllowed: commandInput.provisioning,
    });
    const logger = createLogger(false);

    logger.step('invited', `${createdInvitation.email} - [${createdInvitation.roles.join(', ')}]`);
  } catch (cause) {
    throw teamCommandFailure('invite', cause);
  }
}

/** Confirm and remove one member or pending invitation. */
async function removeFromTeam(commandInput: TeamRemoveInput): Promise<void> {
  try {
    const confirmed = await confirmTeamWrite(
      `Remove ${commandInput.email} from the team (revoke access / cancel invitation)?`,
      commandInput.yes,
    );

    const declined = confirmed == false;

    if (declined) {
      return;
    }

    const appleStore = await loadActiveAppleStore();
    const removeOutcome = await removeTeamMember(appleStore, commandInput.email);
    const logger = createLogger(false);

    if (removeOutcome.kind == 'member') {
      logger.step('removed', `${removeOutcome.user.username} - access revoked`);
      return;
    }

    if (removeOutcome.kind == 'invitation') {
      logger.step('invitation cancelled', removeOutcome.invitation.email);
      return;
    }

    logger.note(
      `No team member or pending invitation matches ${commandInput.email} - nothing to remove.`,
    );
  } catch (cause) {
    throw teamCommandFailure('remove', cause);
  }
}

/** Dispatch one decoded team operation. */
async function runTeamOperation(commandInput: TeamCommandInput): Promise<void> {
  if (commandInput.operation == 'list') {
    await listTeam(commandInput);
    return;
  }

  if (commandInput.operation == 'invite') {
    await inviteTeam(commandInput);
    return;
  }

  await removeFromTeam(commandInput);
}

/** Run one decoded team command. Decode failures are reported as list. */
export async function teamCommandProgram(rawCommandInput: unknown): Promise<void> {
  let commandInput: TeamCommandInput;

  try {
    commandInput = TeamCommandInputSchema(rawCommandInput);
  } catch (cause) {
    throw teamCommandFailure('list', cause);
  }

  await runTeamOperation(commandInput);
}

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
