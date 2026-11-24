// Reads App Store Connect members and invites or removes them by email.

import type {
  NewUserInvitation,
  UserInvitationResource,
  UserResource,
} from '../types/apple-catalog.ts';
import { hasMessage } from '../services/platform/error-message.ts';

/** App Store Connect operations needed for team membership. */
export type AscTeamApi = Readonly<{
  listUsers: () => Promise<UserResource[]>;
  listUserInvitations: () => Promise<UserInvitationResource[]>;
  inviteUser: (newInvitation: NewUserInvitation) => Promise<UserInvitationResource>;
  deleteUser: (userId: string) => Promise<void>;
  cancelUserInvitation: (invitationId: string) => Promise<void>;
}>;

const DEPRECATED_ROLE_PERMISSION = 'ACCESS_TO_REPORTS';

const KNOWN_USER_ROLES: readonly string[] = [
  'ADMIN',
  'FINANCE',
  'ACCOUNT_HOLDER',
  'SALES',
  'MARKETING',
  'APP_MANAGER',
  'DEVELOPER',
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

type InviteRequest = Readonly<{
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  allAppsVisible?: boolean;
  provisioningAllowed?: boolean;
}>;

type RemoveOutcome =
  | Readonly<{ kind: 'member'; user: UserResource }>
  | Readonly<{ kind: 'invitation'; invitation: UserInvitationResource }>
  | Readonly<{ kind: 'none' }>;

function readNonEmptyText(cause: unknown): string | null {
  const isNotText = typeof cause != 'string';

  if (isNotText) return null;

  const isEmpty = cause.length == 0;

  if (isEmpty) return null;

  return cause;
}

function readCauseMessage(cause: unknown, fallback: string): string {
  const textMessage = readNonEmptyText(cause);

  if (textMessage != null) return textMessage;

  const hasCauseMessage = hasMessage(cause);

  if (hasCauseMessage) return cause.message;

  return fallback;
}

/** Convert a team dependency failure into an Error. */
function teamFailure(operation: 'list' | 'invite' | 'remove', cause: unknown): never {
  const message = readCauseMessage(cause, `Team ${operation} failed.`);

  throw new Error(message, { cause });
}

/** Read accepted members and pending invitations together. */
export async function getTeam(teamClient: AscTeamApi): Promise<Team> {
  try {
    const membersPromise = teamClient.listUsers();
    const invitationsPromise = teamClient.listUserInvitations();
    const [members, invitations] = await Promise.all([membersPromise, invitationsPromise]);
    return { members, invitations };
  } catch (cause) {
    throw teamFailure('list', cause);
  }
}

/** Normalize comma-separated role fragments into Apple's canonical role names. */
function normalizeRoles(declaredRoles: readonly string[]): string[] {
  const normalizedRoles = new Set<string>();

  for (const declaredRole of declaredRoles) {
    const normalizedRole = declaredRole.trim().toUpperCase();

    const hasRoleText = normalizedRole.length > 0;

    if (hasRoleText) {
      normalizedRoles.add(normalizedRole);
    }
  }

  return [...normalizedRoles];
}

function isUnknownRole(normalizedRole: string): boolean {
  const isKnownRole = KNOWN_USER_ROLES.includes(normalizedRole);
  return isKnownRole == false;
}

function hasMemberEmail(normalizedEmail: string): (teamMember: UserResource) => boolean {
  return function memberHasEmail(teamMember: UserResource): boolean {
    return teamMember.username.toLowerCase() == normalizedEmail;
  };
}

function hasInvitationEmail(
  normalizedEmail: string,
): (pendingInvitation: UserInvitationResource) => boolean {
  return function invitationHasEmail(pendingInvitation: UserInvitationResource): boolean {
    return pendingInvitation.email.toLowerCase() == normalizedEmail;
  };
}

/** Validate and invite a new App Store Connect team member. */
export async function inviteTeamMember(
  teamClient: AscTeamApi,
  inviteRequest: InviteRequest,
): Promise<UserInvitationResource> {
  const email = inviteRequest.email.trim();

  const isEmailMissing = email.length == 0;

  if (isEmailMissing) {
    throw teamFailure('invite', 'An email is required to invite a team member.');
  }

  const normalizedRoles = normalizeRoles(inviteRequest.roles);

  const isRoleListEmpty = normalizedRoles.length == 0;

  if (isRoleListEmpty) {
    throw teamFailure(
      'invite',
      `At least one role is required. Valid roles: ${KNOWN_USER_ROLES.join(', ')}.`,
    );
  }

  const usesDeprecatedRole = normalizedRoles.includes(DEPRECATED_ROLE_PERMISSION);

  if (usesDeprecatedRole) {
    throw teamFailure(
      'invite',
      `${DEPRECATED_ROLE_PERMISSION} is deprecated by Apple (App Store Connect API 4.3). Report access comes with the Sales, Marketing, App Manager, and Developer roles: use one of them. Valid roles: ${KNOWN_USER_ROLES.join(', ')}.`,
    );
  }

  const unknownRoles = normalizedRoles.filter(isUnknownRole);

  const hasUnknownRoles = unknownRoles.length > 0;

  if (hasUnknownRoles) {
    throw teamFailure(
      'invite',
      `Unknown role(s): ${unknownRoles.join(', ')}. Valid roles: ${KNOWN_USER_ROLES.join(', ')}.`,
    );
  }

  let currentTeam: Team;

  try {
    currentTeam = await getTeam(teamClient);
  } catch (cause) {
    throw teamFailure('invite', cause);
  }

  const normalizedEmail = email.toLowerCase();
  const memberHasEmail = hasMemberEmail(normalizedEmail);

  const isAlreadyMember = currentTeam.members.some(memberHasEmail);

  if (isAlreadyMember) {
    throw teamFailure('invite', `${email} is already a team member.`);
  }

  const invitationHasEmail = hasInvitationEmail(normalizedEmail);

  const hasPendingInvitation = currentTeam.invitations.some(invitationHasEmail);

  if (hasPendingInvitation) {
    throw teamFailure('invite', `${email} already has a pending invitation.`);
  }

  let allAppsVisible = true;

  if (inviteRequest.allAppsVisible != null) {
    allAppsVisible = inviteRequest.allAppsVisible;
  }

  let provisioningAllowed = false;

  if (inviteRequest.provisioningAllowed != null) {
    provisioningAllowed = inviteRequest.provisioningAllowed;
  }

  try {
    return await teamClient.inviteUser({
      email,
      firstName: inviteRequest.firstName.trim(),
      lastName: inviteRequest.lastName.trim(),
      roles: normalizedRoles,
      allAppsVisible,
      provisioningAllowed,
    });
  } catch (cause) {
    throw teamFailure('invite', cause);
  }
}

/** Revoke a member or cancel a pending invitation matched by email. */
export async function removeTeamMember(
  teamClient: AscTeamApi,
  email: string,
): Promise<RemoveOutcome> {
  const normalizedEmail = email.trim().toLowerCase();
  let currentTeam: Team;

  try {
    currentTeam = await getTeam(teamClient);
  } catch (cause) {
    throw teamFailure('remove', cause);
  }

  const memberHasEmail = hasMemberEmail(normalizedEmail);
  const matchingMember = currentTeam.members.find(memberHasEmail);

  const hasMatchingMember = matchingMember != null;

  if (hasMatchingMember) {
    try {
      await teamClient.deleteUser(matchingMember.id);
    } catch (cause) {
      throw teamFailure('remove', cause);
    }

    return { kind: 'member', user: matchingMember };
  }

  const invitationHasEmail = hasInvitationEmail(normalizedEmail);
  const matchingInvitation = currentTeam.invitations.find(invitationHasEmail);

  const hasMatchingInvitation = matchingInvitation != null;

  if (hasMatchingInvitation) {
    try {
      await teamClient.cancelUserInvitation(matchingInvitation.id);
    } catch (cause) {
      throw teamFailure('remove', cause);
    }

    return { kind: 'invitation', invitation: matchingInvitation };
  }

  return { kind: 'none' };
}
