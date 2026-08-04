import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describePlayErrors,
  GooglePlayClient,
  parseServiceAccount,
  type GooglePlayTransport,
} from './playClient.js';
/** Minimal valid service-account JSON for adapter construction. */
const makeServiceAccountJson = (): string => {
  return JSON.stringify({
    type: 'service_account',
    client_email: 'launch@proj.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
    private_key_id: 'kid-123',
    token_uri: 'https://oauth2.googleapis.com/token',
  });
};
const insertEdit = vi.fn();
const commitEdit = vi.fn();
const deleteEdit = vi.fn();
const listBundles = vi.fn();
const convertRegionPrices = vi.fn();
const unusedGeneratedRequest = vi.fn();
/** Build the generated-client slice exercised by this adapter test. */
const generatedPublisherFake = (): GooglePlayTransport => {
  return {
    edits: {
      insert: insertEdit,
      commit: commitEdit,
      delete: deleteEdit,
      bundles: { list: listBundles },
      tracks: {
        get: unusedGeneratedRequest,
        list: unusedGeneratedRequest,
        update: unusedGeneratedRequest,
      },
      testers: { get: unusedGeneratedRequest, update: unusedGeneratedRequest },
      countryavailability: { get: unusedGeneratedRequest },
    },
    inappproducts: {
      list: unusedGeneratedRequest,
      insert: unusedGeneratedRequest,
      update: unusedGeneratedRequest,
    },
    monetization: {
      convertRegionPrices,
      subscriptions: {
        list: unusedGeneratedRequest,
        create: unusedGeneratedRequest,
        patch: unusedGeneratedRequest,
        basePlans: {
          activate: unusedGeneratedRequest,
          offers: {
            list: unusedGeneratedRequest,
            create: unusedGeneratedRequest,
            activate: unusedGeneratedRequest,
          },
        },
      },
    },
    reviews: {
      list: unusedGeneratedRequest,
      get: unusedGeneratedRequest,
      reply: unusedGeneratedRequest,
    },
  };
};
let client: GooglePlayClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new GooglePlayClient(
    Effect.runSync(parseServiceAccount(makeServiceAccountJson())),
    generatedPublisherFake(),
  );
});
describe('parseServiceAccount', () => {
  it('extracts the fields Launch needs from a valid key', () => {
    const account = Effect.runSync(parseServiceAccount(makeServiceAccountJson()));
    expect(account.clientEmail).toBe('launch@proj.iam.gserviceaccount.com');
    expect(account.privateKey).toContain('PRIVATE KEY');
    expect(account.tokenUri).toBe('https://oauth2.googleapis.com/token');
    expect(account.privateKeyId).toBe('kid-123');
  });
  it('defaults the token endpoint when absent', () => {
    const account = Effect.runSync(
      parseServiceAccount(
        JSON.stringify({
          client_email: 'a@b.iam',
          private_key: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
        }),
      ),
    );
    expect(account.tokenUri).toBe('https://oauth2.googleapis.com/token');
  });
  it('rejects non-JSON and the wrong key kind with actionable text', async () => {
    await expect(Effect.runPromise(parseServiceAccount('not json'))).rejects.toMatchObject({
      message: expect.stringMatching(/not valid JSON/),
    });
    await expect(
      Effect.runPromise(parseServiceAccount(JSON.stringify({ type: 'authorized_user' }))),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/client_email.*private_key/),
    });
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
  });
  it('falls back to raw text, then a placeholder when empty', () => {
    expect(describePlayErrors('plain failure')).toBe('plain failure');
    expect(describePlayErrors('')).toBe('no response body');
  });
});
describe('GooglePlayClient generated reads', () => {
  it('returns the highest uploaded version code and abandons the read edit', async () => {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    listBundles.mockResolvedValue({
      data: { bundles: [{ versionCode: 3 }, { versionCode: 7 }] },
    });
    deleteEdit.mockResolvedValue({ data: undefined });
    expect(await Effect.runPromise(client.getLatestVersionCode('com.example.hello'))).toBe(7);
    expect(insertEdit).toHaveBeenCalledWith({ packageName: 'com.example.hello' });
    expect(listBundles).toHaveBeenCalledWith({
      packageName: 'com.example.hello',
      editId: 'edit1',
    });
    expect(deleteEdit).toHaveBeenCalledWith({
      packageName: 'com.example.hello',
      editId: 'edit1',
    });
  });
  it('reports zero when no bundles have been uploaded', async () => {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    listBundles.mockResolvedValue({ data: {} });
    deleteEdit.mockResolvedValue({ data: undefined });
    expect(await Effect.runPromise(client.getLatestVersionCode('com.example.fresh'))).toBe(0);
  });
  it('raises PlayAppNotFoundError when edit creation reports a missing app', async () => {
    insertEdit.mockRejectedValue(
      Object.assign(new Error('Application not found.'), { status: 404 }),
    );
    const appLookupFailure = await Effect.runPromise(
      Effect.flip(client.assertAppExists('com.example.missing')),
    );
    expect(appLookupFailure).toMatchObject({ _tag: 'PlayAppNotFoundError' });
  });
});
describe('GooglePlayClient.withEdit', () => {
  it('opens an edit, applies the write, then commits', async () => {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    commitEdit.mockResolvedValue({ data: {} });
    const appliedEditId = await Effect.runPromise(
      client.withEdit('com.example.app', (editId) => Effect.succeed(editId)),
    );
    expect(appliedEditId).toBe('edit1');
    expect(commitEdit).toHaveBeenCalledWith({ packageName: 'com.example.app', editId: 'edit1' });
    expect(deleteEdit).not.toHaveBeenCalled();
  });
  it('abandons the edit when the write fails', async () => {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    deleteEdit.mockResolvedValue({ data: undefined });
    await expect(
      Effect.runPromise(client.withEdit('com.example.app', () => Effect.fail(new Error('boom')))),
    ).rejects.toThrow('boom');
    expect(commitEdit).not.toHaveBeenCalled();
    expect(deleteEdit).toHaveBeenCalledWith({ packageName: 'com.example.app', editId: 'edit1' });
  });
});
describe('GooglePlayClient.convertRegionPrices', () => {
  it('normalizes generated prices into sorted regions and fallback money', async () => {
    convertRegionPrices.mockResolvedValue({
      data: {
        convertedRegionPrices: {
          US: {
            regionCode: 'US',
            price: { currencyCode: 'USD', units: '4', nanos: 990000000 },
          },
          DE: {
            regionCode: 'DE',
            price: { currencyCode: 'EUR', units: '4', nanos: 490000000 },
          },
          JP: { regionCode: 'JP', price: { currencyCode: 'JPY', units: '600', nanos: 0 } },
        },
        convertedOtherRegionsPrice: {
          usdPrice: { currencyCode: 'USD', units: '4', nanos: 990000000 },
          eurPrice: { currencyCode: 'EUR', units: '4', nanos: 490000000 },
        },
      },
    });
    const convertedPrices = await Effect.runPromise(
      client.convertRegionPrices('com.example.app', {
        currencyCode: 'USD',
        units: '4',
        nanos: 990000000,
      }),
    );
    expect(convertRegionPrices).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      requestBody: {
        price: { currencyCode: 'USD', units: '4', nanos: 990000000 },
      },
    });
    expect(convertedPrices.regions.map((regionPrice) => regionPrice.regionCode)).toEqual([
      'DE',
      'JP',
      'US',
    ]);
    expect(convertedPrices.regions[2]).toEqual({
      regionCode: 'US',
      price: { currencyCode: 'USD', units: '4', nanos: 990000000 },
    });
    expect(convertedPrices.otherRegions?.usdPrice.units).toBe('4');
    expect(convertedPrices.otherRegions?.eurPrice.currencyCode).toBe('EUR');
  });
  it('drops missing region codes, fills missing money fields, and omits absent fallback', async () => {
    convertRegionPrices.mockResolvedValue({
      data: {
        convertedRegionPrices: {
          GB: { regionCode: 'GB', price: { currencyCode: 'GBP' } },
          missing: { price: { currencyCode: 'USD', units: '1', nanos: 0 } },
        },
      },
    });
    const convertedPrices = await Effect.runPromise(
      client.convertRegionPrices('com.example.app', {
        currencyCode: 'USD',
        units: '1',
        nanos: 0,
      }),
    );
    expect(convertedPrices.regions).toEqual([
      { regionCode: 'GB', price: { currencyCode: 'GBP', units: '0', nanos: 0 } },
    ]);
    expect(convertedPrices.otherRegions).toBeUndefined();
  });
  it('passes the optional product tax category to the generated request', async () => {
    convertRegionPrices.mockResolvedValue({ data: { convertedRegionPrices: {} } });
    await Effect.runPromise(
      client.convertRegionPrices(
        'com.example.app',
        { currencyCode: 'USD', units: '4', nanos: 0 },
        'TAX_CATEGORY',
      ),
    );
    expect(convertRegionPrices).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      requestBody: {
        price: { currencyCode: 'USD', units: '4', nanos: 0 },
        productTaxCategoryCode: 'TAX_CATEGORY',
      },
    });
  });
});
