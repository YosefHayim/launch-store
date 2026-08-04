import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { renderTeam, TeamCommandInputSchema } from './teamCommand.js';

describe('TeamCommandInputSchema', () => {
  it('decodes every Commander operation', () => {
    expect(
      Schema.decodeUnknownSync(TeamCommandInputSchema)({ operation: 'list', json: false }),
    ).toEqual({ operation: 'list', json: false });
    expect(
      Schema.decodeUnknownSync(TeamCommandInputSchema)({
        operation: 'invite',
        email: 'new@acme.com',
        first: 'Pat',
        last: 'Lee',
        role: 'DEVELOPER',
        provisioning: true,
        yes: false,
      }),
    ).toEqual({
      operation: 'invite',
      email: 'new@acme.com',
      first: 'Pat',
      last: 'Lee',
      role: 'DEVELOPER',
      provisioning: true,
      yes: false,
    });
    expect(
      Schema.decodeUnknownSync(TeamCommandInputSchema)({
        operation: 'remove',
        email: 'old@acme.com',
        yes: true,
      }),
    ).toEqual({ operation: 'remove', email: 'old@acme.com', yes: true });
  });
});

describe('renderTeam', () => {
  it('renders members and pending invitations as one ASCII block', () => {
    expect(
      renderTeam({
        members: [
          {
            id: 'member-1',
            username: 'member@acme.com',
            firstName: 'Ada',
            lastName: 'Lovelace',
            roles: ['ADMIN'],
          },
        ],
        invitations: [
          {
            id: 'invitation-1',
            email: 'invitee@acme.com',
            roles: ['DEVELOPER'],
            expirationDate: '2026-08-20T00:00:00Z',
          },
        ],
      }),
    ).toBe(
      'Team - 1 member(s), 1 pending invitation(s)\n\nMembers:\n  member@acme.com  Ada Lovelace  [ADMIN]\n\nPending invitations:\n  invitee@acme.com  [DEVELOPER]  expires 2026-08-20',
    );
  });
});
