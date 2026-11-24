// Reads App Store Connect members and invites or removes them by email.

import type {
  NewUserInvitation,
  UserInvitationResource,
  UserResource,
} from '../types/apple/users-and-access.ts';
import { errorMessage } from '../services/platform/error-message.ts';

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

/** Read accepted members and pending invitations together. */
export async function getTeam(teamClient: AscTeamApi): Promise<Team> {
  try {
    const membersPromise = teamClient.listUsers();
    const invitationsPromise = teamClient.listUserInvitations();
    const [members, invitations] = await Promise.all([membersPromise, invitationsPromise]);
    return { members, invitations };
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
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
    throw new Error(errorMessage('An email is required to invite a team member.'), {
      cause: 'An email is required to invite a team member.',
    });
  }

  const normalizedRoles = normalizeRoles(inviteRequest.roles);

  const isRoleListEmpty = normalizedRoles.length == 0;

  if (isRoleListEmpty) {
    throw new Error(
      errorMessage(`At least one role is required. Valid roles: ${KNOWN_USER_ROLES.join(', ')}.`),
      { cause: `At least one role is required. Valid roles: ${KNOWN_USER_ROLES.join(', ')}.` },
    );
  }

  const usesDeprecatedRole = normalizedRoles.includes(DEPRECATED_ROLE_PERMISSION);

  if (usesDeprecatedRole) {
    throw new Error(
      errorMessage(
        `${DEPRECATED_ROLE_PERMISSION} is deprecated by Apple (App Store Connect API 4.3). Report access comes with the Sales, Marketing, App Manager, and Developer roles: use one of them. Valid roles: ${KNOWN_USER_ROLES.join(', ')}.`,
      ),
      {
        cause: `${DEPRECATED_ROLE_PERMISSION} is deprecated by Apple (App Store Connect API 4.3). Report access comes with the Sales, Marketing, App Manager, and Developer roles: use one of them. Valid roles: ${KNOWN_USER_ROLES.join(', ')}.`,
      },
    );
  }

  const unknownRoles = normalizedRoles.filter(isUnknownRole);

  const hasUnknownRoles = unknownRoles.length > 0;

  if (hasUnknownRoles) {
    throw new Error(
      errorMessage(
        `Unknown role(s): ${unknownRoles.join(', ')}. Valid roles: ${KNOWN_USER_ROLES.join(', ')}.`,
      ),
      {
        cause: `Unknown role(s): ${unknownRoles.join(', ')}. Valid roles: ${KNOWN_USER_ROLES.join(', ')}.`,
      },
    );
  }

  try {
    var currentTeam = await getTeam(teamClient);
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  const normalizedEmail = email.toLowerCase();
  const memberHasEmail = hasMemberEmail(normalizedEmail);

  const isAlreadyMember = currentTeam.members.some(memberHasEmail);

  if (isAlreadyMember) {
    throw new Error(errorMessage(`${email} is already a team member.`), {
      cause: `${email} is already a team member.`,
    });
  }

  const invitationHasEmail = hasInvitationEmail(normalizedEmail);

  const hasPendingInvitation = currentTeam.invitations.some(invitationHasEmail);

  if (hasPendingInvitation) {
    throw new Error(errorMessage(`${email} already has a pending invitation.`), {
      cause: `${email} already has a pending invitation.`,
    });
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
    throw new Error(errorMessage(cause), { cause: cause });
  }
}

/** Revoke a member or cancel a pending invitation matched by email. */
export async function removeTeamMember(
  teamClient: AscTeamApi,
  email: string,
): Promise<RemoveOutcome> {
  const normalizedEmail = email.trim().toLowerCase();
  try {
    var currentTeam = await getTeam(teamClient);
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  const memberHasEmail = hasMemberEmail(normalizedEmail);
  const matchingMember = currentTeam.members.find(memberHasEmail);

  const hasMatchingMember = matchingMember != null;

  if (hasMatchingMember) {
    try {
      await teamClient.deleteUser(matchingMember.id);
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
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
      throw new Error(errorMessage(cause), { cause: cause });
    }

    return { kind: 'invitation', invitation: matchingInvitation };
  }

  return { kind: 'none' };
}
