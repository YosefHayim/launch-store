import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectArrayElement } from '@testkit/assertions.testkit.js';
import {
  fakeResponse,
  makeKey,
  readRequestDocument,
} from '@/app-store-connect-api/test-helpers.js';
import {
  type AppStoreConnectApi,
  makeAppStoreConnectApi,
} from '@/app-store-connect-api/app-store-connect-api.js';
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
describe('AppStoreConnectClient - TestFlight beta groups + testers', () => {
  it('creates an external beta group with the app relationship', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({ data: { id: 'bg1', attributes: { name: 'External Testers' } } }),
      ),
    );
    const group = await client.createBetaGroup('app1', 'External Testers');
    expect(group).toEqual({ id: 'bg1', name: 'External Testers' });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/betaGroups');
    expect(init.method).toBe('POST');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'betaGroups',
        attributes: { name: 'External Testers' },
        relationships: { app: { data: { type: 'apps', id: 'app1' } } },
      },
    });
  });
  it('lists beta groups, dropping a nameless row and surfacing internal/public-link', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 'bg1',
              attributes: { name: 'External', isInternalGroup: false, publicLink: 'https://tf/x' },
            },
            { id: 'bg2', attributes: { name: 'Team', isInternalGroup: true } },
            { id: 'bg3', attributes: {} },
          ],
        }),
      ),
    );
    expect(await client.listBetaGroups('app1')).toEqual([
      { id: 'bg1', name: 'External', isInternal: false, publicLink: 'https://tf/x' },
      { id: 'bg2', name: 'Team', isInternal: true },
    ]);
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/apps/app1/betaGroups',
    );
  });
  it('finds a beta group by name case-insensitively', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({ data: [{ id: 'bg1', attributes: { name: 'External Testers' } }] }),
      ),
    );
    expect((await client.findBetaGroupByName('app1', 'external testers'))?.id).toBe('bg1');
  });
  it('creates a tester with the betaGroups relationship (the invite-sending path)', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 't1', attributes: { email: 'a@x.com', firstName: 'Dana', state: 'INVITED' } },
        }),
      ),
    );
    const tester = await client.createBetaTester('bg1', { email: 'a@x.com', firstName: 'Dana' });
    expect(tester).toMatchObject({
      id: 't1',
      email: 'a@x.com',
      firstName: 'Dana',
      state: 'INVITED',
    });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/betaTesters');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'betaTesters',
        attributes: { email: 'a@x.com', firstName: 'Dana' },
        relationships: { betaGroups: { data: [{ type: 'betaGroups', id: 'bg1' }] } },
      },
    });
  });
  it('keeps a public-link tester with a null email and omits null names', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 't-public',
              attributes: { email: null, firstName: null, lastName: null, state: 'INSTALLED' },
            },
            {
              id: 't-invited',
              attributes: { email: 'a@x.com', firstName: null, lastName: null, state: 'INVITED' },
            },
          ],
        }),
      ),
    );
    expect(await client.listBetaTestersInGroup('bg1')).toEqual([
      { id: 't-public', email: '', state: 'INSTALLED' },
      { id: 't-invited', email: 'a@x.com', state: 'INVITED' },
    ]);
  });
  it('finds a tester by email via the filter, matching case-insensitively', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ data: [{ id: 't1', attributes: { email: 'A@X.com' } }] })),
    );
    expect((await client.findBetaTesterByEmail('a@x.com'))?.id).toBe('t1');
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/betaTesters?filter[email]=a%40x.com',
    );
  });
  it('bulk-adds existing testers to a group via the relationship endpoint', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ''));
    await client.addTestersToGroup('bg1', ['t1', 't2']);
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/betaGroups/bg1/relationships/betaTesters');
    expect(init.method).toBe('POST');
    expect(readRequestDocument(init)).toEqual({
      data: [
        { type: 'betaTesters', id: 't1' },
        { type: 'betaTesters', id: 't2' },
      ],
    });
  });
  it('removes testers from a group with a DELETE carrying the relationship body', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ''));
    await client.removeTestersFromGroup('bg1', ['t1']);
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/betaGroups/bg1/relationships/betaTesters');
    expect(init.method).toBe('DELETE');
    expect(readRequestDocument(init)).toEqual({ data: [{ type: 'betaTesters', id: 't1' }] });
  });
});
