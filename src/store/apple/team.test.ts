import { describe, expect, it, vi } from 'vitest';
import type {
  NewUserInvitation,
  UserInvitationResource,
  UserResource,
} from '../../types/apple-catalog.ts';
import { getTeam, inviteTeamMember, removeTeamMember, type AscTeamApi } from './team.ts';

/** Build an empty Effect-native team client with optional method replacements. */
const makeTeamClient = (methodOverrides: Partial<AscTeamApi> = {}): AscTeamApi => {
  const fulfilled = Promise.resolve([]);
  const defaultClient: AscTeamApi = {
    listUsers: vi.fn().mockReturnValue(fulfilled),
    listUserInvitations: vi.fn().mockReturnValue(Promise.resolve([])),
    inviteUser: vi.fn().mockImplementation((newInvitation: NewUserInvitation) =>
      Promise.resolve({
        id: 'inv-new',
        email: newInvitation.email,
        roles: newInvitation.roles,
      }),
    ),
    deleteUser: vi.fn().mockReturnValue(Promise.resolve()),
    cancelUserInvitation: vi.fn().mockReturnValue(Promise.resolve()),
  };
  return { ...defaultClient, ...methodOverrides };
};

const teamMember = (fieldOverrides: Partial<UserResource> = {}): UserResource => ({
  id: 'u1',
  username: 'jane@acme.com',
  firstName: 'Jane',
  lastName: 'Doe',
  roles: ['ADMIN'],
  ...fieldOverrides,
});

const pendingInvitation = (
  fieldOverrides: Partial<UserInvitationResource> = {},
): UserInvitationResource => ({
  id: 'i1',
  email: 'john@acme.com',
  firstName: 'John',
  lastName: 'Roe',
  roles: ['DEVELOPER'],
  ...fieldOverrides,
});

describe('getTeam', () => {
  it('returns members and pending invitations together', async () => {
    const fulfilled = Promise.resolve([teamMember()]);
    const teamClient = makeTeamClient({
      listUsers: vi.fn().mockReturnValue(fulfilled),
      listUserInvitations: vi.fn().mockReturnValue(Promise.resolve([pendingInvitation()])),
    });
    const currentTeam = await getTeam(teamClient);
    expect(currentTeam.members).toHaveLength(1);
    expect(currentTeam.invitations).toHaveLength(1);
  });
});

describe('inviteTeamMember', () => {
  it('invites with normalized roles and default permissions', async () => {
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
  });

  it('passes through a provisioning override', async () => {
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
  });

  it('rejects an empty email', async () => {
    const teamClient = makeTeamClient();
    await expect(
      inviteTeamMember(teamClient, {
        email: '  ',
        firstName: 'Pat',
        lastName: 'Lee',
        roles: ['DEVELOPER'],
      }),
    ).rejects.toThrow(/email is required/);
  });

  it('rejects when no roles are given', async () => {
    const teamClient = makeTeamClient();
    await expect(
      inviteTeamMember(teamClient, {
        email: 'new@acme.com',
        firstName: 'Pat',
        lastName: 'Lee',
        roles: ['  '],
      }),
    ).rejects.toThrow(/At least one role is required/);
  });

  it('rejects the deprecated ACCESS_TO_REPORTS permission and names the roles to use', async () => {
    const teamClient = makeTeamClient();
    await expect(
      inviteTeamMember(teamClient, {
        email: 'new@acme.com',
        firstName: 'Pat',
        lastName: 'Lee',
        roles: ['SALES', 'ACCESS_TO_REPORTS'],
      }),
    ).rejects.toThrow(/ACCESS_TO_REPORTS is deprecated by Apple.*Sales, Marketing, App Manager/);
  });

  it('rejects an unknown role with the valid list', async () => {
    const teamClient = makeTeamClient();
    await expect(
      inviteTeamMember(teamClient, {
        email: 'new@acme.com',
        firstName: 'Pat',
        lastName: 'Lee',
        roles: ['WIZARD'],
      }),
    ).rejects.toThrow(/Unknown role\(s\): WIZARD/);
  });

  it('rejects an existing member case-insensitively', async () => {
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
  });

  it('rejects an existing pending invitation', async () => {
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
  });
});

describe('removeTeamMember', () => {
  it('deletes an accepted member matched case-insensitively', async () => {
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
  });

  it('cancels a pending invitation when no member matches', async () => {
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
  });

  it('reports none when nothing matches', async () => {
    const teamClient = makeTeamClient();
    const removeOutcome = await removeTeamMember(teamClient, 'ghost@acme.com');
    expect(removeOutcome).toEqual({ kind: 'none' });
    expect(teamClient.deleteUser).not.toHaveBeenCalled();
    expect(teamClient.cancelUserInvitation).not.toHaveBeenCalled();
  });
});
