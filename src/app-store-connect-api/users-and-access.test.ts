import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeAppStoreConnectApi, type AppStoreConnectApi } from './app-store-connect-api.js';
import { fakeResponse, makeKey, readRequestDocument } from './test-helpers.js';
import { expectArrayElement } from '@testkit/assertions.testkit.js';
const fetchMock = vi.fn();
let client: AppStoreConnectApi;
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  client = makeAppStoreConnectApi(makeKey());
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe('UsersAndAccess API', () => {
  it('lists team users, defaulting missing username and roles', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: 'u1', attributes: { username: 'a@b.c', firstName: 'Ann', roles: ['ADMIN'] } },
            { id: 'u2', attributes: {} },
          ],
        }),
      ),
    );
    expect(await client.listUsers()).toEqual([
      { id: 'u1', username: 'a@b.c', firstName: 'Ann', roles: ['ADMIN'] },
      { id: 'u2', username: '', roles: [] },
    ]);
  });
  it('invites a user with the given roles', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'i1', attributes: { email: 'n@b.c', roles: ['DEVELOPER'] } },
        }),
      ),
    );
    const invitation = await client.inviteUser({
      email: 'n@b.c',
      firstName: 'New',
      lastName: 'User',
      roles: ['DEVELOPER'],
      allAppsVisible: true,
      provisioningAllowed: false,
    });
    expect(invitation).toEqual({ id: 'i1', email: 'n@b.c', roles: ['DEVELOPER'] });
    const [, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('POST');
    expect(readRequestDocument(init)).toMatchObject({
      data: { type: 'userInvitations', attributes: { email: 'n@b.c', roles: ['DEVELOPER'] } },
    });
  });
  it('deletes a user and cancels an invitation by id', async () => {
    fetchMock.mockResolvedValue(fakeResponse(204, ''));
    await client.deleteUser('u1');
    await client.cancelUserInvitation('i1');
    expect(String(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0])).toContain(
      '/users/u1',
    );
    expect(String(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[0])).toContain(
      '/userInvitations/i1',
    );
  });
  it('lists sandbox testers from the v2 collection', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({ data: [{ id: 's1', attributes: { acAccountName: 'x@y.z' } }] }),
      ),
    );
    expect(await client.listSandboxTesters()).toEqual([{ id: 's1', acAccountName: 'x@y.z' }]);
    expect(String(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0])).toContain(
      '/v2/sandboxTesters',
    );
  });
});
