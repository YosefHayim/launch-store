import { Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import type { UserInvitationResource, UserResource } from '../types/appleCatalog.js';
import { loadActiveAppleStore, type ActiveAppleStoreRequirements } from './appleStoreCommand.js';
import { getTeam, inviteTeamMember, removeTeamMember, type Team } from './team.js';

const TeamListInputSchema = Schema.Struct({
  operation: Schema.Literal('list'),
  json: Schema.Boolean,
});

const TeamInviteInputSchema = Schema.Struct({
  operation: Schema.Literal('invite'),
  email: Schema.String,
  first: Schema.String,
  last: Schema.String,
  role: Schema.String,
  provisioning: Schema.Boolean,
  yes: Schema.Boolean,
});

const TeamRemoveInputSchema = Schema.Struct({
  operation: Schema.Literal('remove'),
  email: Schema.String,
  yes: Schema.Boolean,
});

export const TeamCommandInputSchema = Schema.Union(
  TeamListInputSchema,
  TeamInviteInputSchema,
  TeamRemoveInputSchema,
);

export type TeamCommandInput = Schema.Schema.Type<typeof TeamCommandInputSchema>;
export type TeamListInput = Schema.Schema.Type<typeof TeamListInputSchema>;
export type TeamInviteInput = Schema.Schema.Type<typeof TeamInviteInputSchema>;
export type TeamRemoveInput = Schema.Schema.Type<typeof TeamRemoveInputSchema>;

/** A team command step failed. */
export type TeamCommandFailure = Readonly<{
  readonly _tag: 'TeamCommandFailure';
  readonly operation: TeamCommandInput['operation'];
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeTeamCommandFailure = Data.tagged<TeamCommandFailure>('TeamCommandFailure');

type TeamCommandRequirements =
  | ActiveAppleStoreRequirements
  | LaunchPromptService
  | Logger
  | Terminal.Terminal;

/** Convert a dependency failure into the team command channel. */
const teamCommandFailure = (
  operation: TeamCommandInput['operation'],
  cause: unknown,
): TeamCommandFailure => {
  let message = `Team ${operation} failed.`;
  if (typeof cause === 'string' && cause.length > 0) message = cause;
  if (cause instanceof Error) message = cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const causeMessage = cause.message;
    if (typeof causeMessage === 'string') message = causeMessage;
  }
  return makeTeamCommandFailure({ operation, message, cause });
};

/** Join a person's available first and last names. */
export const teamMemberFullName = (person: { firstName?: string; lastName?: string }): string => {
  const nameParts: string[] = [];
  if (person.firstName !== undefined) nameParts.push(person.firstName);
  if (person.lastName !== undefined) nameParts.push(person.lastName);
  return nameParts.join(' ');
};

/** Render one accepted team member. */
export const renderTeamMember = (teamMember: UserResource): string => {
  const memberDetails = [teamMember.username];
  const memberName = teamMemberFullName(teamMember);
  if (memberName.length > 0) memberDetails.push(memberName);
  memberDetails.push(`[${teamMember.roles.join(', ')}]`);
  return memberDetails.join('  ');
};

/** Render one pending team invitation. */
export const renderTeamInvitation = (pendingInvitation: UserInvitationResource): string => {
  const invitationDetails = [pendingInvitation.email];
  const invitationName = teamMemberFullName(pendingInvitation);
  if (invitationName.length > 0) invitationDetails.push(invitationName);
  invitationDetails.push(`[${pendingInvitation.roles.join(', ')}]`);
  if (pendingInvitation.expirationDate !== undefined) {
    invitationDetails.push(`expires ${pendingInvitation.expirationDate.slice(0, 10)}`);
  }
  return invitationDetails.join('  ');
};

/** Render accepted members and invitations as one readable block. */
export const renderTeam = (currentTeam: Team): string => {
  const teamLines = [
    `Team - ${currentTeam.members.length} member(s), ${currentTeam.invitations.length} pending invitation(s)`,
  ];
  if (currentTeam.members.length > 0) {
    teamLines.push('', 'Members:');
    for (const teamMember of currentTeam.members) {
      teamLines.push(`  ${renderTeamMember(teamMember)}`);
    }
  }
  if (currentTeam.invitations.length > 0) {
    teamLines.push('', 'Pending invitations:');
    for (const pendingInvitation of currentTeam.invitations) {
      teamLines.push(`  ${renderTeamInvitation(pendingInvitation)}`);
    }
  }
  return teamLines.join('\n');
};

/** Confirm a team access change. */
const confirmTeamWrite = (
  confirmationMessage: string,
  assumeYes: boolean,
): Effect.Effect<boolean, TeamCommandFailure, LaunchPromptService | Terminal.Terminal> =>
  Effect.gen(function* () {
    if (assumeYes) return true;
    const terminal = yield* Terminal.Terminal;
    if (!(yield* terminal.isTTY)) {
      return yield* Effect.fail(
        makeTeamCommandFailure({
          operation: 'invite',
          message:
            'Refusing to change team access without confirmation. Re-run with --yes (non-interactive).',
          cause: 'confirmation-required',
        }),
      );
    }
    const prompt = yield* LaunchPrompt;
    const confirmed = yield* prompt
      .confirm(confirmationMessage)
      .pipe(Effect.mapError((cause) => teamCommandFailure('invite', cause)));
    if (confirmed) return true;
    yield* prompt.cancel('Aborted - no team changes made.');
    return false;
  });

/** List the App Store Connect team. */
const listTeam = (
  commandInput: TeamListInput,
): Effect.Effect<void, TeamCommandFailure, TeamCommandRequirements> =>
  Effect.gen(function* () {
    const appleStore = yield* loadActiveAppleStore();
    const currentTeam = yield* getTeam(appleStore);
    const logger = yield* createLogger(false);
    if (commandInput.json) {
      yield* logger.line(JSON.stringify(currentTeam, null, 2));
      return;
    }
    yield* logger.line(renderTeam(currentTeam));
  }).pipe(Effect.mapError((cause) => teamCommandFailure('list', cause)));

/** Confirm and invite one App Store Connect team member. */
const inviteTeam = (
  commandInput: TeamInviteInput,
): Effect.Effect<void, TeamCommandFailure, TeamCommandRequirements> =>
  Effect.gen(function* () {
    const confirmed = yield* confirmTeamWrite(
      `Invite ${commandInput.email} to the team (sends them an email)?`,
      commandInput.yes,
    );
    if (!confirmed) return;
    const appleStore = yield* loadActiveAppleStore();
    const createdInvitation = yield* inviteTeamMember(appleStore, {
      email: commandInput.email,
      firstName: commandInput.first,
      lastName: commandInput.last,
      roles: commandInput.role.split(','),
      provisioningAllowed: commandInput.provisioning,
    });
    const logger = yield* createLogger(false);
    yield* logger.step(
      'invited',
      `${createdInvitation.email} - [${createdInvitation.roles.join(', ')}]`,
    );
  }).pipe(Effect.mapError((cause) => teamCommandFailure('invite', cause)));

/** Confirm and remove one member or pending invitation. */
const removeFromTeam = (
  commandInput: TeamRemoveInput,
): Effect.Effect<void, TeamCommandFailure, TeamCommandRequirements> =>
  Effect.gen(function* () {
    const confirmed = yield* confirmTeamWrite(
      `Remove ${commandInput.email} from the team (revoke access / cancel invitation)?`,
      commandInput.yes,
    );
    if (!confirmed) return;
    const appleStore = yield* loadActiveAppleStore();
    const removeOutcome = yield* removeTeamMember(appleStore, commandInput.email);
    const logger = yield* createLogger(false);
    switch (removeOutcome.kind) {
      case 'member':
        yield* logger.step('removed', `${removeOutcome.user.username} - access revoked`);
        return;
      case 'invitation':
        yield* logger.step('invitation cancelled', removeOutcome.invitation.email);
        return;
      case 'none':
        yield* logger.note(
          `No team member or pending invitation matches ${commandInput.email} - nothing to remove.`,
        );
    }
  }).pipe(Effect.mapError((cause) => teamCommandFailure('remove', cause)));

/** Dispatch one decoded team operation. */
const runTeamOperation = (
  commandInput: TeamCommandInput,
): Effect.Effect<void, TeamCommandFailure, TeamCommandRequirements> => {
  switch (commandInput.operation) {
    case 'list':
      return listTeam(commandInput);
    case 'invite':
      return inviteTeam(commandInput);
    case 'remove':
      return removeFromTeam(commandInput);
  }
};

/** Run one schema-decoded team command. */
export const teamCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, TeamCommandFailure, TeamCommandRequirements> =>
  Schema.decodeUnknown(TeamCommandInputSchema)(rawCommandInput).pipe(
    Effect.mapError((cause) => teamCommandFailure('list', cause)),
    Effect.flatMap(runTeamOperation),
  );
