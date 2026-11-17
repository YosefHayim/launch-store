import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectArrayElement } from '@testkit/assertions.testkit.js';
import {
  documentValueAt,
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
describe('Beta App Review submissions', () => {
  it('reads the review verdict of a build', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({ data: { id: 'sub-1', attributes: { betaReviewState: 'APPROVED' } } }),
      ),
    );
    expect(await client.getBetaAppReviewSubmission('build-1')).toEqual({
      id: 'sub-1',
      state: 'APPROVED',
    });
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/builds/build-1/betaAppReviewSubmission',
    );
  });
  it('returns null when the build was never submitted for beta review', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(404, JSON.stringify({ errors: [] })));
    expect(await client.getBetaAppReviewSubmission('build-2')).toBeNull();
  });
  it('submits a build for beta review through the build relationship', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(201, JSON.stringify({ data: { id: 'sub-2' } })));
    await client.createBetaAppReviewSubmission('build-3');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/betaAppReviewSubmissions');
    const document = readRequestDocument(init);
    expect(documentValueAt(document, ['data', 'relationships', 'build', 'data', 'id'])).toBe(
      'build-3',
    );
  });
});
