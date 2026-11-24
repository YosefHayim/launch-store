import { describe, expect, it, vi } from 'vitest';
import type {
  NewUserInvitation,
  UserInvitationResource,
  UserResource,
} from '../types/apple/users-and-access.ts';
import { getTeam, inviteTeamMember, removeTeamMember, type AscTeamApi } from './team.ts';

/** Build an empty Effect-native team client with optional method replacements. */
function makeTeamClient(methodOverrides: Partial<AscTeamApi> = {}): AscTeamApi {
  const fulfilled = Promise.resolve([]);

  function mockImplementationNewInvitation(newInvitation: NewUserInvitation) {
    return Promise.resolve({
      id: 'inv-new',
      email: newInvitation.email,
      roles: newInvitation.roles,
    });
  }

  const defaultClient: AscTeamApi = {
    listUsers: vi.fn().mockReturnValue(fulfilled),
    listUserInvitations: vi.fn().mockReturnValue(Promise.resolve([])),
    inviteUser: vi.fn().mockImplementation(mockImplementationNewInvitation),
    deleteUser: vi.fn().mockReturnValue(Promise.resolve()),
    cancelUserInvitation: vi.fn().mockReturnValue(Promise.resolve()),
  };

  return { ...defaultClient, ...methodOverrides };
}

function teamMember(fieldOverrides: Partial<UserResource> = {}): UserResource {
  return {
    id: 'u1',
    username: 'jane@acme.com',
    firstName: 'Jane',
    lastName: 'Doe',
    roles: ['ADMIN'],
    ...fieldOverrides,
  };
}

function pendingInvitation(
  fieldOverrides: Partial<UserInvitationResource> = {},
): UserInvitationResource {
  return {
    id: 'i1',
    email: 'john@acme.com',
    firstName: 'John',
    lastName: 'Roe',
    roles: ['DEVELOPER'],
    ...fieldOverrides,
  };
}

function describeGetTeam() {
  async function returnsMembersAndPendingInvitationsTogether() {
    const fulfilled = Promise.resolve([teamMember()]);
    const teamClient = makeTeamClient({
      listUsers: vi.fn().mockReturnValue(fulfilled),
      listUserInvitations: vi.fn().mockReturnValue(Promise.resolve([pendingInvitation()])),
    });
    const currentTeam = await getTeam(teamClient);

    expect(currentTeam.members).toHaveLength(1);
    expect(currentTeam.invitations).toHaveLength(1);
  }

  it(
    'returns members and pending invitations together',
    returnsMembersAndPendingInvitationsTogether,
  );
}

describe('getTeam', describeGetTeam);

function describeInviteTeamMember() {
  async function invitesWithNormalizedRolesAndDefaultPermissions() {
    const teamClient = makeTeamClient();
    const createdInvitation = await inviteTeamMember(teamClient, {
      email: 'new@acme.com',
      firstName: ' Pat ',
      lastName: ' Lee ',
      roles: ['developer', 'Developer', ' app_manager '],
    });

    expect(teamClient.inviteUser).toHaveBeenCalledWith({
      email: 'new@acme.com',
      firstName: 'Pat',
      lastName: 'Lee',
      roles: ['DEVELOPER', 'APP_MANAGER'],
      allAppsVisible: true,
      provisioningAllowed: false,
    });
    expect(createdInvitation.email).toBe('new@acme.com');
  }

  it(
    'invites with normalized roles and default permissions',
    invitesWithNormalizedRolesAndDefaultPermissions,
  );

  async function passesThroughAProvisioningOverride() {
    const teamClient = makeTeamClient();

    await inviteTeamMember(teamClient, {
      email: 'new@acme.com',
      firstName: 'Pat',
      lastName: 'Lee',
      roles: ['DEVELOPER'],
      provisioningAllowed: true,
    });
    expect(teamClient.inviteUser).toHaveBeenCalledWith(
      expect.objectContaining({ provisioningAllowed: true }),
    );
  }

  it('passes through a provisioning override', passesThroughAProvisioningOverride);

  async function rejectsAnEmptyEmail() {
    const teamClient = makeTeamClient();

    await expect(
      inviteTeamMember(teamClient, {
        email: '  ',
        firstName: 'Pat',
        lastName: 'Lee',
        roles: ['DEVELOPER'],
      }),
    ).rejects.toThrow(/email is required/);
  }

  it('rejects an empty email', rejectsAnEmptyEmail);

  async function rejectsWhenNoRolesAreGiven() {
    const teamClient = makeTeamClient();

    await expect(
      inviteTeamMember(teamClient, {
        email: 'new@acme.com',
        firstName: 'Pat',
        lastName: 'Lee',
        roles: ['  '],
      }),
    ).rejects.toThrow(/At least one role is required/);
  }

  it('rejects when no roles are given', rejectsWhenNoRolesAreGiven);

  async function rejectsTheDeprecatedACCESSTOREPORTSPermissionAndNamesTheRolesToUse() {
    const teamClient = makeTeamClient();

    await expect(
      inviteTeamMember(teamClient, {
        email: 'new@acme.com',
        firstName: 'Pat',
        lastName: 'Lee',
        roles: ['SALES', 'ACCESS_TO_REPORTS'],
      }),
    ).rejects.toThrow(/ACCESS_TO_REPORTS is deprecated by Apple.*Sales, Marketing, App Manager/);
  }

  it(
    'rejects the deprecated ACCESS_TO_REPORTS permission and names the roles to use',
    rejectsTheDeprecatedACCESSTOREPORTSPermissionAndNamesTheRolesToUse,
  );

  async function rejectsAnUnknownRoleWithTheValidList() {
    const teamClient = makeTeamClient();

    await expect(
      inviteTeamMember(teamClient, {
        email: 'new@acme.com',
        firstName: 'Pat',
        lastName: 'Lee',
        roles: ['WIZARD'],
      }),
    ).rejects.toThrow(/Unknown role\(s\): WIZARD/);
  }

  it('rejects an unknown role with the valid list', rejectsAnUnknownRoleWithTheValidList);

  async function rejectsAnExistingMemberCaseInsensitively() {
    const fulfilled = Promise.resolve([teamMember({ username: 'Jane@Acme.com' })]);
    const teamClient = makeTeamClient({
      listUsers: vi.fn().mockReturnValue(fulfilled),
    });

    await expect(
      inviteTeamMember(teamClient, {
        email: 'jane@acme.com',
        firstName: 'Jane',
        lastName: 'Doe',
        roles: ['ADMIN'],
      }),
    ).rejects.toThrow(/already a team member/);
    expect(teamClient.inviteUser).not.toHaveBeenCalled();
  }

  it('rejects an existing member case-insensitively', rejectsAnExistingMemberCaseInsensitively);

  async function rejectsAnExistingPendingInvitation() {
    const fulfilled = Promise.resolve([pendingInvitation({ email: 'john@acme.com' })]);
    const teamClient = makeTeamClient({
      listUserInvitations: vi.fn().mockReturnValue(fulfilled),
    });

    await expect(
      inviteTeamMember(teamClient, {
        email: 'john@acme.com',
        firstName: 'John',
        lastName: 'Roe',
        roles: ['DEVELOPER'],
      }),
    ).rejects.toThrow(/already has a pending invitation/);
    expect(teamClient.inviteUser).not.toHaveBeenCalled();
  }

  it('rejects an existing pending invitation', rejectsAnExistingPendingInvitation);
}

describe('inviteTeamMember', describeInviteTeamMember);

function describeRemoveTeamMember() {
  async function deletesAnAcceptedMemberMatchedCaseInsensitively() {
    const fulfilled = Promise.resolve([teamMember({ id: 'u9', username: 'jane@acme.com' })]);
    const teamClient = makeTeamClient({
      listUsers: vi.fn().mockReturnValue(fulfilled),
    });
    const removeOutcome = await removeTeamMember(teamClient, 'JANE@acme.com');

    expect(removeOutcome).toEqual({
      kind: 'member',
      user: expect.objectContaining({ id: 'u9' }),
    });
    expect(teamClient.deleteUser).toHaveBeenCalledWith('u9');
    expect(teamClient.cancelUserInvitation).not.toHaveBeenCalled();
  }

  it(
    'deletes an accepted member matched case-insensitively',
    deletesAnAcceptedMemberMatchedCaseInsensitively,
  );

  async function cancelsAPendingInvitationWhenNoMemberMatches() {
    const fulfilled = Promise.resolve([pendingInvitation({ id: 'i9', email: 'john@acme.com' })]);
    const teamClient = makeTeamClient({
      listUserInvitations: vi.fn().mockReturnValue(fulfilled),
    });
    const removeOutcome = await removeTeamMember(teamClient, 'john@acme.com');

    expect(removeOutcome).toEqual({
      kind: 'invitation',
      invitation: expect.objectContaining({ id: 'i9' }),
    });
    expect(teamClient.cancelUserInvitation).toHaveBeenCalledWith('i9');
    expect(teamClient.deleteUser).not.toHaveBeenCalled();
  }

  it(
    'cancels a pending invitation when no member matches',
    cancelsAPendingInvitationWhenNoMemberMatches,
  );

  async function reportsNoneWhenNothingMatches() {
    const teamClient = makeTeamClient();
    const removeOutcome = await removeTeamMember(teamClient, 'ghost@acme.com');

    expect(removeOutcome).toEqual({ kind: 'none' });
    expect(teamClient.deleteUser).not.toHaveBeenCalled();
    expect(teamClient.cancelUserInvitation).not.toHaveBeenCalled();
  }

  it('reports none when nothing matches', reportsNoneWhenNothingMatches);
}

describe('removeTeamMember', describeRemoveTeamMember);
