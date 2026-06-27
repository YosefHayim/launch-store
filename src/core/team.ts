/**
 * The `launch team` domain: read the App Store Connect team (accepted members + pending invitations),
 * invite a new member, and remove a member — all through the App Store Connect API key, no portal session.
 * This is the CLI equivalent of the "Users and Access" page; EAS has no equivalent (team membership is a
 * pure App Store Connect concern).
 *
 * Design (mirrors `core/reviews.ts`):
 * - **Stateless & read-first.** Every call reads the live account; there's no local cache to drift. The
 *   team is account-wide, so nothing here is app-scoped.
 * - **Two write paths, made safe.** Inviting emails a person (outward-facing) and removing revokes access;
 *   the command confirms both. {@link inviteTeamMember} pre-checks for an existing member/invitation so it
 *   fails fast with a clear message instead of surfacing Apple's opaque duplicate error.
 * - **Removal keys on email.** ASC users are keyed by `username` (their Apple ID email) and invitations by
 *   `email`; {@link removeTeamMember} resolves either from one email, deleting the user or cancelling the
 *   invitation as appropriate.
 *
 * The {@link AscTeamApi} slice mirrors `core/reviews.ts`'s `AscReviewsApi`: it names the exact client
 * surface this module needs, so the logic is unit-testable with a hand-rolled fake and
 * `AppStoreConnectClient` satisfies it structurally.
 */

import type {
  NewUserInvitation,
  UserInvitationResource,
  UserResource,
} from '../apple/ascClient.js';

/** The exact slice of {@link AppStoreConnectClient} the team domain depends on. */
export interface AscTeamApi {
  listUsers(): Promise<UserResource[]>;
  listUserInvitations(): Promise<UserInvitationResource[]>;
  inviteUser(invite: NewUserInvitation): Promise<UserInvitationResource>;
  deleteUser(userId: string): Promise<void>;
  cancelUserInvitation(invitationId: string): Promise<void>;
}

/**
 * Apple's assignable team roles (`UserRole`), used to validate `--role` before hitting the API so a typo
 * gets an actionable error rather than an opaque 4xx. `ACCOUNT_HOLDER` is included for recognition but
 * Apple rejects assigning it via the API (it's the single account owner). Kept in sync with the OpenAPI
 * enum; an unknown role here means the schema moved and this list should be regenerated.
 */
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

/** The whole team in one shot: accepted members and still-pending invitations. */
export interface Team {
  /** People who have accepted access. */
  members: UserResource[];
  /** Invitations sent but not yet accepted. */
  invitations: UserInvitationResource[];
}

/** What the caller wants to invite — the CLI-facing request before defaults/normalization are applied. */
export interface InviteRequest {
  email: string;
  firstName: string;
  lastName: string;
  /** Raw roles (any case); normalized + validated by {@link inviteTeamMember}. */
  roles: string[];
  /** Grant visibility to all apps. Defaults to true (the sensible CLI default). */
  allAppsVisible?: boolean;
  /** Let the member create signing assets. Defaults to false. */
  provisioningAllowed?: boolean;
}

/**
 * The result of {@link removeTeamMember}: which kind of record matched the email (an accepted member, a
 * pending invitation, or nothing), carrying the matched record so the command can report it.
 */
export type RemoveOutcome =
  | { kind: 'member'; user: UserResource }
  | { kind: 'invitation'; invitation: UserInvitationResource }
  | { kind: 'none' };

/** Read the whole team — members and pending invitations — in parallel. */
export async function getTeam(api: AscTeamApi): Promise<Team> {
  const [members, invitations] = await Promise.all([api.listUsers(), api.listUserInvitations()]);
  return { members, invitations };
}

/** Trim, upper-case, drop blanks, and de-duplicate raw `--role` values into Apple's canonical form. */
function normalizeRoles(roles: string[]): string[] {
  const seen = new Set<string>();
  for (const role of roles) {
    const normalized = role.trim().toUpperCase();
    if (normalized) seen.add(normalized);
  }
  return [...seen];
}

/**
 * Invite a new team member. Validates the email and roles up front (rejecting unknown roles with the valid
 * list), and pre-checks that the person isn't already a member or already invited so the failure is clear
 * rather than Apple's generic duplicate error. Defaults: visible to all apps, provisioning off.
 */
export async function inviteTeamMember(
  api: AscTeamApi,
  request: InviteRequest,
): Promise<UserInvitationResource> {
  const email = request.email.trim();
  if (!email) throw new Error('An email is required to invite a team member.');

  const roles = normalizeRoles(request.roles);
  if (roles.length === 0) {
    throw new Error(`At least one role is required. Valid roles: ${KNOWN_USER_ROLES.join(', ')}.`);
  }
  const unknown = roles.filter((role) => !KNOWN_USER_ROLES.includes(role));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown role(s): ${unknown.join(', ')}. Valid roles: ${KNOWN_USER_ROLES.join(', ')}.`,
    );
  }

  const { members, invitations } = await getTeam(api);
  const lower = email.toLowerCase();
  if (members.some((member) => member.username.toLowerCase() === lower)) {
    throw new Error(`${email} is already a team member.`);
  }
  if (invitations.some((invitation) => invitation.email.toLowerCase() === lower)) {
    throw new Error(`${email} already has a pending invitation.`);
  }

  return api.inviteUser({
    email,
    firstName: request.firstName.trim(),
    lastName: request.lastName.trim(),
    roles,
    allAppsVisible: request.allAppsVisible ?? true,
    provisioningAllowed: request.provisioningAllowed ?? false,
  });
}

/**
 * Remove a team member by email: delete the accepted user if one matches, else cancel a pending invitation,
 * else report that nothing matched. Matching is case-insensitive on the user's `username` / invitation's
 * `email`. Returns the outcome so the command can report exactly what it did.
 */
export async function removeTeamMember(api: AscTeamApi, email: string): Promise<RemoveOutcome> {
  const target = email.trim().toLowerCase();
  const { members, invitations } = await getTeam(api);

  const member = members.find((candidate) => candidate.username.toLowerCase() === target);
  if (member) {
    await api.deleteUser(member.id);
    return { kind: 'member', user: member };
  }

  const invitation = invitations.find((candidate) => candidate.email.toLowerCase() === target);
  if (invitation) {
    await api.cancelUserInvitation(invitation.id);
    return { kind: 'invitation', invitation };
  }

  return { kind: 'none' };
}
