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
describe('app-level release attributes', () => {
  it('reads review details, creates them with the version relationship, and patches updates', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({ data: { id: 'rd1', attributes: { contactEmail: 'a@b.co' } } }),
      ),
    );
    expect(await client.getAppStoreReviewDetail('v-edit')).toEqual({
      id: 'rd1',
      attributes: { contactEmail: 'a@b.co' },
    });
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'rd2', attributes: {} } })),
    );
    const created = await client.createAppStoreReviewDetail('v-edit', {
      contactEmail: 'a@b.co',
      demoAccountRequired: false,
    });
    expect(created).toEqual({ id: 'rd2' });
    const createBody = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[1],
    );
    expect(
      documentValueAt(createBody, ['data', 'relationships', 'appStoreVersion', 'data']),
    ).toEqual({
      type: 'appStoreVersions',
      id: 'v-edit',
    });
    expect(documentValueAt(createBody, ['data', 'attributes'])).toEqual({
      contactEmail: 'a@b.co',
      demoAccountRequired: false,
    });
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ data: { id: 'rd2', attributes: {} } })),
    );
    await client.updateAppStoreReviewDetail('rd2', { notes: 'use the QR code' });
    const [patchUrl, patchInit] = expectArrayElement(fetchMock.mock.calls, 2, 'mock call');
    expect(patchInit.method).toBe('PATCH');
    expect(patchUrl).toContain('/appStoreReviewDetails/rd2');
  });
  it('returns null review details on a 404', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(404, JSON.stringify({ errors: [{ title: 'Not Found' }] })),
    );
    expect(await client.getAppStoreReviewDetail('v-edit')).toBeNull();
  });
});
describe('AppStoreConnectClient - App Store release lifecycle', () => {
  it('opens a review submission, adds the version as an item, and submits it', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          201,
          JSON.stringify({ data: { id: 'rs1', attributes: { state: 'READY_FOR_REVIEW' } } }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(201, JSON.stringify({ data: { id: 'item1', attributes: {} } })),
      )
      .mockResolvedValueOnce(fakeResponse(204, ''));
    const submission = await client.createReviewSubmission('app1', 'IOS');
    expect(submission).toEqual({ id: 'rs1', state: 'READY_FOR_REVIEW' });
    await client.addReviewSubmissionItem('rs1', 'v1');
    await client.submitReviewSubmission('rs1');
    expect(
      readRequestDocument(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1]),
    ).toMatchObject({
      data: {
        type: 'reviewSubmissions',
        attributes: { platform: 'IOS' },
        relationships: { app: { data: { id: 'app1' } } },
      },
    });
    expect(
      readRequestDocument(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[1]),
    ).toMatchObject({
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { id: 'rs1' } },
          appStoreVersion: { data: { id: 'v1' } },
        },
      },
    });
    expect(
      readRequestDocument(expectArrayElement(fetchMock.mock.calls, 2, 'mock call')[1]),
    ).toMatchObject({
      data: { type: 'reviewSubmissions', id: 'rs1', attributes: { submitted: true } },
    });
  });
});
