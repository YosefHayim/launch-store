import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeAppStoreConnectApi,
  type AppStoreConnectApi,
} from '@/app-store-connect-api/app-store-connect-api.js';
import { fakeResponse, makeKey } from '@/app-store-connect-api/test-helpers.js';
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

describe('Accessibility declarations API', () => {
  it('lists declarations keeping only the support flags and dropping rows without a device family', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 'ad1',
              attributes: { deviceFamily: 'IPHONE', state: 'PUBLISHED', supportsVoiceover: true },
            },
            { id: 'ad2', attributes: { supportsVoiceover: false } },
          ],
        }),
      ),
    );

    const declarations = await client.listAccessibilityDeclarations('app1');

    expect(declarations).toEqual([
      {
        id: 'ad1',
        deviceFamily: 'IPHONE',
        state: 'PUBLISHED',
        support: { supportsVoiceover: true },
      },
    ]);
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/apps/app1/accessibilityDeclarations?limit=200',
    );
  });

  it('creates a draft declaration for one device family', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({ data: { id: 'ad9', attributes: { deviceFamily: 'IPAD' } } }),
      ),
    );

    const declaration = await client.createAccessibilityDeclaration('app1', 'IPAD', {
      supportsVoiceover: true,
    });

    expect(declaration.id).toBe('ad9');
    expect(declaration.state).toBe('DRAFT');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(String(url)).toBe('https://api.appstoreconnect.apple.com/v1/accessibilityDeclarations');
    expect(init.method).toBe('POST');
  });
});
