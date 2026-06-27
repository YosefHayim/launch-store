import { describe, expect, it, vi } from 'vitest';
import type {
  NewUserInvitation,
  UserInvitationResource,
  UserResource,
} from '../apple/ascClient.js';
import { getTeam, inviteTeamMember, removeTeamMember, type AscTeamApi } from './team.js';

/** A stubbed {@link AscTeamApi}: empty team, writes echo their input. Override per test to set up state. */
function makeApi(overrides: Partial<AscTeamApi> = {}): AscTeamApi {
  const base: AscTeamApi = {
    listUsers: vi.fn().mockResolvedValue([]),
    listUserInvitations: vi.fn().mockResolvedValue([]),
    inviteUser: vi
      .fn()
      .mockImplementation((invite: NewUserInvitation) =>
        Promise.resolve({ id: 'inv-new', email: invite.email, roles: invite.roles }),
      ),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    cancelUserInvitation: vi.fn().mockResolvedValue(undefined),
  };
  return { ...base, ...overrides };
}

function member(overrides: Partial<UserResource> = {}): UserResource {
  return {
    id: 'u1',
    username: 'jane@acme.com',
    firstName: 'Jane',
    lastName: 'Doe',
    roles: ['ADMIN'],
    ...overrides,
  };
}

function invitation(overrides: Partial<UserInvitationResource> = {}): UserInvitationResource {
  return {
    id: 'i1',
    email: 'john@acme.com',
    firstName: 'John',
    lastName: 'Roe',
    roles: ['DEVELOPER'],
    ...overrides,
  };
}

describe('getTeam', () => {
  it('returns members and pending invitations together', async () => {
    const api = makeApi({
      listUsers: vi.fn().mockResolvedValue([member()]),
      listUserInvitations: vi.fn().mockResolvedValue([invitation()]),
    });
    const team = await getTeam(api);
    expect(team.members).toHaveLength(1);
    expect(team.invitations).toHaveLength(1);
  });
});

describe('inviteTeamMember', () => {
  it('invites with normalized roles and the default visibility/provisioning', async () => {
    const api = makeApi();
    const created = await inviteTeamMember(api, {
      email: 'new@acme.com',
      firstName: ' Pat ',
      lastName: ' Lee ',
      roles: ['developer', 'Developer', ' app_manager '],
    });
    expect(api.inviteUser).toHaveBeenCalledWith({
      email: 'new@acme.com',
      firstName: 'Pat',
      lastName: 'Lee',
      roles: ['DEVELOPER', 'APP_MANAGER'],
      allAppsVisible: true,
      provisioningAllowed: false,
    });
    expect(created.email).toBe('new@acme.com');
  });

  it('passes through a provisioning override', async () => {
    const api = makeApi();
    await inviteTeamMember(api, {
      email: 'new@acme.com',
      firstName: 'Pat',
      lastName: 'Lee',
      roles: ['DEVELOPER'],
      provisioningAllowed: true,
    });
    expect(api.inviteUser).toHaveBeenCalledWith(
      expect.objectContaining({ provisioningAllowed: true }),
    );
  });

  it('rejects an empty email', async () => {
    await expect(
      inviteTeamMember(makeApi(), {
        email: '  ',
        firstName: 'Pat',
        lastName: 'Lee',
        roles: ['DEVELOPER'],
      }),
    ).rejects.toThrow(/email is required/);
  });

  it('rejects when no roles are given', async () => {
    await expect(
      inviteTeamMember(makeApi(), {
        email: 'new@acme.com',
        firstName: 'Pat',
        lastName: 'Lee',
        roles: ['  '],
      }),
    ).rejects.toThrow(/At least one role is required/);
  });

  it('rejects an unknown role with the valid list', async () => {
    await expect(
      inviteTeamMember(makeApi(), {
        email: 'new@acme.com',
        firstName: 'Pat',
        lastName: 'Lee',
        roles: ['WIZARD'],
      }),
    ).rejects.toThrow(/Unknown role\(s\): WIZARD/);
  });

  it('rejects inviting someone who is already a member (case-insensitive)', async () => {
    const api = makeApi({
      listUsers: vi.fn().mockResolvedValue([member({ username: 'Jane@Acme.com' })]),
    });
    await expect(
      inviteTeamMember(api, {
        email: 'jane@acme.com',
        firstName: 'Jane',
        lastName: 'Doe',
        roles: ['ADMIN'],
      }),
    ).rejects.toThrow(/already a team member/);
    expect(api.inviteUser).not.toHaveBeenCalled();
  });

  it('rejects inviting someone who already has a pending invitation', async () => {
    const api = makeApi({
      listUserInvitations: vi.fn().mockResolvedValue([invitation({ email: 'john@acme.com' })]),
    });
    await expect(
      inviteTeamMember(api, {
        email: 'john@acme.com',
        firstName: 'John',
        lastName: 'Roe',
        roles: ['DEVELOPER'],
      }),
    ).rejects.toThrow(/already has a pending invitation/);
    expect(api.inviteUser).not.toHaveBeenCalled();
  });
});

describe('removeTeamMember', () => {
  it('deletes an accepted member matched by email (case-insensitive)', async () => {
    const api = makeApi({
      listUsers: vi.fn().mockResolvedValue([member({ id: 'u9', username: 'jane@acme.com' })]),
    });
    const outcome = await removeTeamMember(api, 'JANE@acme.com');
    expect(outcome).toEqual({ kind: 'member', user: expect.objectContaining({ id: 'u9' }) });
    expect(api.deleteUser).toHaveBeenCalledWith('u9');
    expect(api.cancelUserInvitation).not.toHaveBeenCalled();
  });

  it('cancels a pending invitation when no member matches', async () => {
    const api = makeApi({
      listUserInvitations: vi
        .fn()
        .mockResolvedValue([invitation({ id: 'i9', email: 'john@acme.com' })]),
    });
    const outcome = await removeTeamMember(api, 'john@acme.com');
    expect(outcome).toEqual({
      kind: 'invitation',
      invitation: expect.objectContaining({ id: 'i9' }),
    });
    expect(api.cancelUserInvitation).toHaveBeenCalledWith('i9');
    expect(api.deleteUser).not.toHaveBeenCalled();
  });

  it('reports none when nothing matches, touching no write', async () => {
    const api = makeApi();
    const outcome = await removeTeamMember(api, 'ghost@acme.com');
    expect(outcome).toEqual({ kind: 'none' });
    expect(api.deleteUser).not.toHaveBeenCalled();
    expect(api.cancelUserInvitation).not.toHaveBeenCalled();
  });
});
