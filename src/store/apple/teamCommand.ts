import { createLogger } from '../../services/platform/logger.js';
import { LaunchPrompt } from '../../services/platform/prompt.js';
import { checkTerminalIsInteractive } from '../../services/platform/progress.js';
import type { UserInvitationResource, UserResource } from '../../types/appleCatalog.js';
import { loadActiveAppleStore } from './appleStoreCommand.js';
import { getTeam, inviteTeamMember, removeTeamMember, type Team } from './team.js';
import { hasMessage } from '../../services/platform/errorMessage.js';

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

/** A team command step failed. */
type TeamCommandFailure = Readonly<{
  readonly _tag: 'TeamCommandFailure';
  readonly operation: TeamCommandInput['operation'];
  readonly message: string;
  readonly cause: unknown;
}>;

function makeTeamCommandFailure(fields: {
  operation: TeamCommandInput['operation'];
  message: string;
  cause: unknown;
}): TeamCommandFailure {
  return { _tag: 'TeamCommandFailure', ...fields };
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  if (Array.isArray(candidate)) {
    return false;
  }

  return true;
}

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
  const isCommandRecord = isRecord(rawCommandInput);

  if (isCommandRecord == false) {
    throw new Error('Team command input must be an object.');
  }

  const operation = rawCommandInput['operation'];

  if (operation == 'list') {
    return { operation: 'list', json: readFlag(rawCommandInput, 'json') };
  }

  if (operation == 'invite') {
    return {
      operation: 'invite',
      email: readText(rawCommandInput, 'email'),
      first: readText(rawCommandInput, 'first'),
      last: readText(rawCommandInput, 'last'),
      role: readText(rawCommandInput, 'role'),
      provisioning: readFlag(rawCommandInput, 'provisioning'),
      yes: readFlag(rawCommandInput, 'yes'),
    };
  }

  if (operation == 'remove') {
    return {
      operation: 'remove',
      email: readText(rawCommandInput, 'email'),
      yes: readFlag(rawCommandInput, 'yes'),
    };
  }

  throw new Error('Unknown team command.');
}

/** Convert a dependency failure into the team command channel. */
function teamCommandFailure(
  operation: TeamCommandInput['operation'],
  cause: unknown,
): TeamCommandFailure {
  if (typeof cause == 'string') {
    const hasCauseText = cause.length > 0;

    if (hasCauseText) {
      return makeTeamCommandFailure({ operation, message: cause, cause });
    }
  }

  if (hasMessage(cause)) {
    return makeTeamCommandFailure({ operation, message: cause.message, cause });
  }

  return makeTeamCommandFailure({ operation, message: `Team ${operation} failed.`, cause });
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
      teamLines.push(`  ${renderTeamInvitation(pendingInvitation)}`);
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
    throw makeTeamCommandFailure({
      operation: 'invite',
      message:
        'Refusing to change team access without confirmation. Re-run with --yes (non-interactive).',
      cause: 'confirmation-required',
    });
  }

  let confirmed = false;

  try {
    confirmed = await LaunchPrompt.confirm(confirmationMessage);
  } catch (cause) {
    throw teamCommandFailure('invite', cause);
  }

  if (confirmed) {
    return true;
  }

  LaunchPrompt.cancel('Aborted - no team changes made.');
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
      logger.line(JSON.stringify(currentTeam, null, 2));
      return;
    }

    logger.line(renderTeam(currentTeam));
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
