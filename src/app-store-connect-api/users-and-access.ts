// Docs: https://developer.apple.com/documentation/appstoreconnectapi/users
import type {
  NewUserInvitation,
  SandboxTesterResource,
  UserInvitationResource,
  UserResource,
} from '@core/types/appleCatalog.js';
import type { AppStoreConnectRequests } from './api-client.js';
export const makeUsersAndAccessApi = (api: AppStoreConnectRequests) => {
  /** List the account's sandbox testers (the `/v2/sandboxTesters` collection), across all pages. */
  const listSandboxTesters = async (): Promise<SandboxTesterResource[]> => {
    const appleResources = await api.requestAll<{
      acAccountName?: string;
      firstName?: string;
      lastName?: string;
      territory?: string;
      applePayCompatible?: boolean;
      interruptPurchases?: boolean;
      subscriptionRenewalRate?: string;
    }>(api.v2('/sandboxTesters?limit=200'));
    return appleResources.map((tester) => {
      let accountName = tester.attributes.acAccountName;
      if (accountName === undefined) accountName = '';
      const sandboxTester: SandboxTesterResource = { id: tester.id, acAccountName: accountName };
      if (tester.attributes.firstName !== undefined)
        Object.assign(sandboxTester, { firstName: tester.attributes.firstName });
      if (tester.attributes.lastName !== undefined)
        Object.assign(sandboxTester, { lastName: tester.attributes.lastName });
      if (tester.attributes.territory !== undefined)
        Object.assign(sandboxTester, { territory: tester.attributes.territory });
      if (tester.attributes.applePayCompatible !== undefined)
        Object.assign(sandboxTester, { applePayCompatible: tester.attributes.applePayCompatible });
      if (tester.attributes.interruptPurchases !== undefined)
        Object.assign(sandboxTester, { interruptPurchases: tester.attributes.interruptPurchases });
      if (tester.attributes.subscriptionRenewalRate !== undefined)
        Object.assign(sandboxTester, {
          subscriptionRenewalRate: tester.attributes.subscriptionRenewalRate,
        });
      return sandboxTester;
    });
  };
  /** Clear the StoreKit purchase history for one or more sandbox testers (a single batched request). */
  const clearSandboxTesterPurchaseHistory = async (testerIds: readonly string[]): Promise<void> => {
    await api.createResource(api.v2('/sandboxTestersClearPurchaseHistoryRequest'), {
      type: 'sandboxTestersClearPurchaseHistoryRequest',
      relationships: {
        sandboxTesters: { data: testerIds.map((id) => ({ type: 'sandboxTesters', id })) },
      },
    });
  };
  /** List the App Store Connect team members (people who have accepted access). */
  const listUsers = async (): Promise<UserResource[]> => {
    const appleResources = await api.requestAll<{
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
  };
  /** List the pending (not-yet-accepted) team invitations. */
  const listUserInvitations = async (): Promise<UserInvitationResource[]> => {
    const appleResources = await api.requestAll<{
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
  };
  /** Invite a new team member by email with the given roles; returns the created pending invitation. */
  const inviteUser = async (invite: NewUserInvitation): Promise<UserInvitationResource> => {
    const appleResources = await api.createResource<{
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
  };
  /** Remove a team member (an accepted user) by their resource id - revokes their access. */
  const deleteUser = async (userId: string): Promise<void> => {
    await api.deleteResource(`/users/${userId}`);
  };
  /** Cancel a pending invitation by its resource id. */
  const cancelUserInvitation = async (invitationId: string): Promise<void> => {
    await api.deleteResource(`/userInvitations/${invitationId}`);
  };
  return {
    listSandboxTesters,
    clearSandboxTesterPurchaseHistory,
    listUsers,
    listUserInvitations,
    inviteUser,
    deleteUser,
    cancelUserInvitation,
  };
};
