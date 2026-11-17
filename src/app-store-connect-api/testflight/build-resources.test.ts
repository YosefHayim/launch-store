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
describe('Build resources - What to Test notes', () => {
  it('lists the notes per locale and skips rows without a locale', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: 'loc-1', attributes: { locale: 'en-US', whatsNew: 'Fixes' } },
            { id: 'loc-2', attributes: {} },
          ],
        }),
      ),
    );
    expect(await client.listBetaBuildLocalizations('build-1')).toEqual([
      { id: 'loc-1', locale: 'en-US', whatsNew: 'Fixes' },
    ]);
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/builds/build-1/betaBuildLocalizations',
    );
  });
  it('creates a note for one locale on the build', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(201, JSON.stringify({ data: { id: 'loc-3' } })));
    await client.createBetaBuildLocalization('build-1', 'fr-FR', 'Correctifs');
    const [, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const document = readRequestDocument(init);
    expect(documentValueAt(document, ['data', 'attributes', 'locale'])).toBe('fr-FR');
    expect(documentValueAt(document, ['data', 'relationships', 'build', 'data', 'id'])).toBe(
      'build-1',
    );
  });
  it('updates the note text by localization id', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: { id: 'loc-1' } })));
    await client.updateBetaBuildLocalization('loc-1', 'More fixes');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/betaBuildLocalizations/loc-1');
    expect(init.method).toBe('PATCH');
    expect(documentValueAt(readRequestDocument(init), ['data', 'attributes', 'whatsNew'])).toBe(
      'More fixes',
    );
  });
});
