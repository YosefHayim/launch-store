import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describePlayErrors,
  nonEmptyPageToken,
  parseServiceAccount,
  serviceAccountJwtOptions,
} from './api-client.js';
import {
  commitEdit,
  deleteEdit,
  insertEdit,
  listInAppProducts,
  makeServiceAccountJson,
  makeTestApi,
  rejectionOf,
} from './test-helpers.js';

let client: ReturnType<typeof makeTestApi>;
beforeEach(() => {
  vi.clearAllMocks();
  client = makeTestApi();
});
describe('parseServiceAccount', () => {
  it('extracts the fields Launch needs from a valid key', () => {
    const account = parseServiceAccount(makeServiceAccountJson());
    expect(account.clientEmail).toBe('launch@proj.iam.gserviceaccount.com');
    expect(account.privateKey).toContain('PRIVATE KEY');
    expect(account.tokenUri).toBe('https://oauth2.googleapis.com/token');
    expect(account.privateKeyId).toBe('kid-123');
    expect(client.serviceAccountEmail).toBe('launch@proj.iam.gserviceaccount.com');
  });
  it('defaults the token endpoint when absent', () => {
    const account = parseServiceAccount(
      JSON.stringify({
        client_email: 'a@b.iam',
        private_key: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
      }),
    );
    expect(account.tokenUri).toBe('https://oauth2.googleapis.com/token');
  });
  it('rejects non-JSON and the wrong key kind with actionable text', () => {
    expect(() => parseServiceAccount('not json')).toThrow(/not valid JSON/);
    expect(() => parseServiceAccount(JSON.stringify({ type: 'authorized_user' }))).toThrow(
      /client_email.*private_key/,
    );
  });
});
describe('serviceAccountJwtOptions / nonEmptyPageToken', () => {
  it('copies the key id when present and drops empty page tokens', () => {
    const account = parseServiceAccount(makeServiceAccountJson());
    expect(serviceAccountJwtOptions(account, ['scope-a'])).toEqual({
      email: 'launch@proj.iam.gserviceaccount.com',
      key: account.privateKey,
      keyId: 'kid-123',
      scopes: ['scope-a'],
    });
    expect(nonEmptyPageToken(undefined)).toBeUndefined();
    expect(nonEmptyPageToken('')).toBeUndefined();
    expect(nonEmptyPageToken('next')).toBe('next');
  });
});
describe('describePlayErrors', () => {
  it("extracts Google's error message", () => {
    expect(
      describePlayErrors(JSON.stringify({ error: { message: 'The app was not found.' } })),
    ).toBe('The app was not found.');
  });
  it('flags a sensitive-permission rejection with the fix', () => {
    const errorText = JSON.stringify({
      error: { message: 'Your app uses a sensitive permission.' },
    });
    expect(describePlayErrors(errorText)).toMatch(/Permissions Declaration/);
    const genericPermissionErrorText = JSON.stringify({
      error: { message: 'The caller does not have permission' },
    });
    expect(describePlayErrors(genericPermissionErrorText)).toBe(
      'The caller does not have permission',
    );
  });
  it('falls back across string error, description, raw text, then empty placeholder', () => {
    expect(describePlayErrors(JSON.stringify({ error: 'quota exceeded' }))).toBe('quota exceeded');
    expect(describePlayErrors(JSON.stringify({ error_description: 'invalid_grant' }))).toBe(
      'invalid_grant',
    );
    expect(describePlayErrors('plain failure')).toBe('plain failure');
    expect(describePlayErrors('')).toBe('no response body');
  });
});
describe('withEdit', () => {
  it('opens an edit, applies the write, then commits', async () => {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    commitEdit.mockResolvedValue({ data: {} });
    const appliedEditId = await client.withEdit('com.example.app', async (editId) => editId);
    expect(appliedEditId).toBe('edit1');
    expect(commitEdit).toHaveBeenCalledWith({ packageName: 'com.example.app', editId: 'edit1' });
    expect(deleteEdit).not.toHaveBeenCalled();
  });
  it('abandons the edit when the write fails', async () => {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    deleteEdit.mockResolvedValue({ data: undefined });
    await expect(
      client.withEdit('com.example.app', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(commitEdit).not.toHaveBeenCalled();
    expect(deleteEdit).toHaveBeenCalledWith({ packageName: 'com.example.app', editId: 'edit1' });
  });
});
describe('send', () => {
  it('tags generated failures with status and operation text', async () => {
    listInAppProducts.mockRejectedValue(
      Object.assign(new Error(JSON.stringify({ error: { message: 'rate limited' } })), {
        status: 429,
      }),
    );
    const listFailure = await rejectionOf(client.listInAppProducts('com.example.app'));
    expect(listFailure).toMatchObject({
      _tag: 'GooglePlayApiError',
      operation: 'list in-app products',
      statusCode: 429,
      message: expect.stringMatching(/rate limited/),
    });
  });
});
