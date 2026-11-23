import type { AscHost } from './host.ts';
import type {
  NewUserInvitation,
  UserInvitationResource,
  UserResource,
} from '@/types/apple-catalog.js';
import { APPLE_PAGE_LIMIT, applyAppleListQuery, type AppleListQuery } from './list-query.ts';

export class ConnectTeam {
  constructor(private readonly client: AscHost) {}

  /**
   * Get a list of the users on your team.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-users
   */
  async listUsers(listQuery: AppleListQuery | null = null): Promise<UserResource[]> {
    const appleResources = await this.client.requestAll<{
      username?: string;
      firstName?: string;
      lastName?: string;
      roles?: string[];
    }>(
      applyAppleListQuery(
        '/users?fields[users]=username,firstName,lastName,roles',
        listQuery,
        APPLE_PAGE_LIMIT,
      ),
    );

    function copyTeamUser(user: {
      id: string;
      attributes: { username?: string; firstName?: string; lastName?: string; roles?: string[] };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let username = user.attributes.username;

      if (username == null) username = '';

      let roles = user.attributes.roles;

      if (roles == null) roles = [];

      const teamUser: UserResource = { id: user.id, username, roles };

      if (user.attributes.firstName != null)
        Object.assign(teamUser, { firstName: user.attributes.firstName });

      if (user.attributes.lastName != null)
        Object.assign(teamUser, { lastName: user.attributes.lastName });

      return teamUser;
    }

    return appleResources.map(copyTeamUser);
  }

  /**
   * Get a list of pending invitations to join your team.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-userinvitations
   */
  async listUserInvitations(
    listQuery: AppleListQuery | null = null,
  ): Promise<UserInvitationResource[]> {
    const appleResources = await this.client.requestAll<{
      email?: string;
      firstName?: string;
      lastName?: string;
      roles?: string[];
      expirationDate?: string;
    }>(
      applyAppleListQuery(
        '/userInvitations?fields[userInvitations]=email,firstName,lastName,roles,expirationDate',
        listQuery,
        APPLE_PAGE_LIMIT,
      ),
    );

    function copyUserInvitation(invitation: {
      id: string;
      attributes: {
        email?: string;
        firstName?: string;
        lastName?: string;
        roles?: string[];
        expirationDate?: string;
      };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let email = invitation.attributes.email;

      if (email == null) email = '';

      let roles = invitation.attributes.roles;

      if (roles == null) roles = [];

      const pendingInvitation: UserInvitationResource = { id: invitation.id, email, roles };

      if (invitation.attributes.firstName != null)
        Object.assign(pendingInvitation, { firstName: invitation.attributes.firstName });

      if (invitation.attributes.lastName != null)
        Object.assign(pendingInvitation, { lastName: invitation.attributes.lastName });

      if (invitation.attributes.expirationDate != null)
        Object.assign(pendingInvitation, { expirationDate: invitation.attributes.expirationDate });

      return pendingInvitation;
    }

    return appleResources.map(copyUserInvitation);
  }

  /**
   * Invite a user with assigned user roles to join your team.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-userinvitations
   */
  async inviteUser(invite: NewUserInvitation): Promise<UserInvitationResource> {
    const appleResources = await this.client.createResource<{
      email?: string;
      firstName?: string;
      lastName?: string;
      roles?: string[];
      expirationDate?: string;
    }>('/userInvitations', {
      type: 'userInvitations',
      attributes: {
        email: invite.email,
        firstName: invite.firstName,
        lastName: invite.lastName,
        roles: [...invite.roles],
        allAppsVisible: invite.allAppsVisible,
        provisioningAllowed: invite.provisioningAllowed,
      },
    });
    let email = appleResources.attributes.email;

    if (email == null) email = invite.email;

    let roles = appleResources.attributes.roles;

    if (roles == null) roles = [...invite.roles];

    const pendingInvitation: UserInvitationResource = { id: appleResources.id, email, roles };

    if (appleResources.attributes.firstName != null)
      Object.assign(pendingInvitation, { firstName: appleResources.attributes.firstName });

    if (appleResources.attributes.lastName != null)
      Object.assign(pendingInvitation, { lastName: appleResources.attributes.lastName });

    if (appleResources.attributes.expirationDate != null)
      Object.assign(pendingInvitation, {
        expirationDate: appleResources.attributes.expirationDate,
      });

    return pendingInvitation;
  }

  /**
   * Remove a user from your team.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-users-_id_
   */
  async deleteUser(userId: string): Promise<void> {
    await this.client.deleteResource(`/users/${userId}`);
  }

  /**
   * Cancel a pending invitation for a user to join your team.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-userinvitations-_id_
   */
  async cancelUserInvitation(invitationId: string): Promise<void> {
    await this.client.deleteResource(`/userInvitations/${invitationId}`);
  }
}
