import type { AscHost } from './host.ts';
import type {
  NewUserInvitation,
  UserInvitationResource,
  UserResource,
} from '../../types/appleCatalog.ts';

export class ConnectTeam {
  constructor(private readonly client: AscHost) {}

  async listUsers(): Promise<UserResource[]> {
    const appleResources = await this.client.requestAll<{
      username?: string;
      firstName?: string;
      lastName?: string;
      roles?: string[];
    }>('/users?limit=200&fields[users]=username,firstName,lastName,roles');
    return appleResources.map((user) => {
      let username = user.attributes.username;
      if (username === undefined) username = '';
      let roles = user.attributes.roles;
      if (roles === undefined) roles = [];
      const teamUser: UserResource = { id: user.id, username, roles };
      if (user.attributes.firstName !== undefined)
        Object.assign(teamUser, { firstName: user.attributes.firstName });
      if (user.attributes.lastName !== undefined)
        Object.assign(teamUser, { lastName: user.attributes.lastName });
      return teamUser;
    });
  }

  async listUserInvitations(): Promise<UserInvitationResource[]> {
    const appleResources = await this.client.requestAll<{
      email?: string;
      firstName?: string;
      lastName?: string;
      roles?: string[];
      expirationDate?: string;
    }>(
      '/userInvitations?limit=200&fields[userInvitations]=email,firstName,lastName,roles,expirationDate',
    );
    return appleResources.map((invitation) => {
      let email = invitation.attributes.email;
      if (email === undefined) email = '';
      let roles = invitation.attributes.roles;
      if (roles === undefined) roles = [];
      const pendingInvitation: UserInvitationResource = { id: invitation.id, email, roles };
      if (invitation.attributes.firstName !== undefined)
        Object.assign(pendingInvitation, { firstName: invitation.attributes.firstName });
      if (invitation.attributes.lastName !== undefined)
        Object.assign(pendingInvitation, { lastName: invitation.attributes.lastName });
      if (invitation.attributes.expirationDate !== undefined)
        Object.assign(pendingInvitation, { expirationDate: invitation.attributes.expirationDate });
      return pendingInvitation;
    });
  }

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
    if (email === undefined) email = invite.email;
    let roles = appleResources.attributes.roles;
    if (roles === undefined) roles = [...invite.roles];
    const pendingInvitation: UserInvitationResource = { id: appleResources.id, email, roles };
    if (appleResources.attributes.firstName !== undefined)
      Object.assign(pendingInvitation, { firstName: appleResources.attributes.firstName });
    if (appleResources.attributes.lastName !== undefined)
      Object.assign(pendingInvitation, { lastName: appleResources.attributes.lastName });
    if (appleResources.attributes.expirationDate !== undefined)
      Object.assign(pendingInvitation, {
        expirationDate: appleResources.attributes.expirationDate,
      });
    return pendingInvitation;
  }

  async deleteUser(userId: string): Promise<void> {
    await this.client.deleteResource(`/users/${userId}`);
  }

  async cancelUserInvitation(invitationId: string): Promise<void> {
    await this.client.deleteResource(`/userInvitations/${invitationId}`);
  }
}
