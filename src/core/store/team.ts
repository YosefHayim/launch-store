import { Data, Effect } from 'effect';
import type {
  NewUserInvitation,
  UserInvitationResource,
  UserResource,
} from '../types/appleCatalog.js';

/** App Store Connect operations needed for team membership. */
export type AscTeamApi = Readonly<{
  listUsers: () => Effect.Effect<UserResource[], unknown>;
  listUserInvitations: () => Effect.Effect<UserInvitationResource[], unknown>;
  inviteUser: (newInvitation: NewUserInvitation) => Effect.Effect<UserInvitationResource, unknown>;
  deleteUser: (userId: string) => Effect.Effect<void, unknown>;
  cancelUserInvitation: (invitationId: string) => Effect.Effect<void, unknown>;
}>;

export const KNOWN_USER_ROLES: readonly string[] = [
  'ADMIN',
  'FINANCE',
  'ACCOUNT_HOLDER',
  'SALES',
  'MARKETING',
  'APP_MANAGER',
  'DEVELOPER',
  'ACCESS_TO_REPORTS',
  'CUSTOMER_SUPPORT',
  'CREATE_APPS',
  'CLOUD_MANAGED_DEVELOPER_ID',
  'CLOUD_MANAGED_APP_DISTRIBUTION',
  'GENERATE_INDIVIDUAL_KEYS',
];

export type Team = Readonly<{
  members: UserResource[];
  invitations: UserInvitationResource[];
}>;

export type InviteRequest = Readonly<{
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  allAppsVisible?: boolean;
  provisioningAllowed?: boolean;
}>;

export type RemoveOutcome =
  | Readonly<{ kind: 'member'; user: UserResource }>
  | Readonly<{ kind: 'invitation'; invitation: UserInvitationResource }>
  | Readonly<{ kind: 'none' }>;

/** A team validation or App Store Connect operation failed. */
export type TeamFailure = Readonly<{
  readonly _tag: 'TeamFailure';
  readonly operation: 'list' | 'invite' | 'remove';
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeTeamFailure = Data.tagged<TeamFailure>('TeamFailure');

/** Convert a team dependency failure to the typed domain channel. */
const teamFailure = (operation: TeamFailure['operation'], cause: unknown): TeamFailure => {
  let message = `Team ${operation} failed.`;
  if (typeof cause === 'string' && cause.length > 0) message = cause;
  if (cause instanceof Error) message = cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const causeMessage = cause.message;
    if (typeof causeMessage === 'string') message = causeMessage;
  }
  return makeTeamFailure({ operation, message, cause });
};

/** Read accepted members and pending invitations together. */
export const getTeam = (teamClient: AscTeamApi): Effect.Effect<Team, TeamFailure> =>
  Effect.all(
    {
      members: teamClient.listUsers(),
      invitations: teamClient.listUserInvitations(),
    },
    { concurrency: 'unbounded' },
  ).pipe(Effect.mapError((cause) => teamFailure('list', cause)));

/** Normalize comma-separated role fragments into Apple's canonical role names. */
const normalizeRoles = (declaredRoles: readonly string[]): string[] => {
  const normalizedRoles = new Set<string>();
  for (const declaredRole of declaredRoles) {
    const normalizedRole = declaredRole.trim().toUpperCase();
    if (normalizedRole.length > 0) normalizedRoles.add(normalizedRole);
  }
  return [...normalizedRoles];
};

/** Validate and invite a new App Store Connect team member. */
export const inviteTeamMember = (
  teamClient: AscTeamApi,
  inviteRequest: InviteRequest,
): Effect.Effect<UserInvitationResource, TeamFailure> =>
  Effect.gen(function* () {
    const email = inviteRequest.email.trim();
    if (email.length === 0) {
      return yield* Effect.fail(
        teamFailure('invite', 'An email is required to invite a team member.'),
      );
    }
    const normalizedRoles = normalizeRoles(inviteRequest.roles);
    if (normalizedRoles.length === 0) {
      return yield* Effect.fail(
        teamFailure(
          'invite',
          `At least one role is required. Valid roles: ${KNOWN_USER_ROLES.join(', ')}.`,
        ),
      );
    }
    const unknownRoles = normalizedRoles.filter(
      (normalizedRole) => !KNOWN_USER_ROLES.includes(normalizedRole),
    );
    if (unknownRoles.length > 0) {
      return yield* Effect.fail(
        teamFailure(
          'invite',
          `Unknown role(s): ${unknownRoles.join(', ')}. Valid roles: ${KNOWN_USER_ROLES.join(', ')}.`,
        ),
      );
    }
    const currentTeam = yield* getTeam(teamClient).pipe(
      Effect.mapError((cause) => teamFailure('invite', cause)),
    );
    const normalizedEmail = email.toLowerCase();
    if (
      currentTeam.members.some(
        (teamMember) => teamMember.username.toLowerCase() === normalizedEmail,
      )
    ) {
      return yield* Effect.fail(teamFailure('invite', `${email} is already a team member.`));
    }
    if (
      currentTeam.invitations.some(
        (pendingInvitation) => pendingInvitation.email.toLowerCase() === normalizedEmail,
      )
    ) {
      return yield* Effect.fail(
        teamFailure('invite', `${email} already has a pending invitation.`),
      );
    }
    let allAppsVisible = true;
    if (inviteRequest.allAppsVisible !== undefined) {
      allAppsVisible = inviteRequest.allAppsVisible;
    }
    let provisioningAllowed = false;
    if (inviteRequest.provisioningAllowed !== undefined) {
      provisioningAllowed = inviteRequest.provisioningAllowed;
    }
    return yield* teamClient
      .inviteUser({
        email,
        firstName: inviteRequest.firstName.trim(),
        lastName: inviteRequest.lastName.trim(),
        roles: normalizedRoles,
        allAppsVisible,
        provisioningAllowed,
      })
      .pipe(Effect.mapError((cause) => teamFailure('invite', cause)));
  });

/** Revoke a member or cancel a pending invitation matched by email. */
export const removeTeamMember = (
  teamClient: AscTeamApi,
  email: string,
): Effect.Effect<RemoveOutcome, TeamFailure> =>
  Effect.gen(function* () {
    const normalizedEmail = email.trim().toLowerCase();
    const currentTeam = yield* getTeam(teamClient).pipe(
      Effect.mapError((cause) => teamFailure('remove', cause)),
    );
    const matchingMember = currentTeam.members.find(
      (teamMember) => teamMember.username.toLowerCase() === normalizedEmail,
    );
    if (matchingMember !== undefined) {
      yield* teamClient
        .deleteUser(matchingMember.id)
        .pipe(Effect.mapError((cause) => teamFailure('remove', cause)));
      return { kind: 'member', user: matchingMember };
    }
    const matchingInvitation = currentTeam.invitations.find(
      (pendingInvitation) => pendingInvitation.email.toLowerCase() === normalizedEmail,
    );
    if (matchingInvitation !== undefined) {
      yield* teamClient
        .cancelUserInvitation(matchingInvitation.id)
        .pipe(Effect.mapError((cause) => teamFailure('remove', cause)));
      return { kind: 'invitation', invitation: matchingInvitation };
    }
    return { kind: 'none' };
  });
