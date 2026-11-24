import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describePlayErrors,
  GooglePlayClient,
  nonEmptyPageToken,
  parseServiceAccount,
  serviceAccountJwtOptions,
  type GooglePlayTransport,
} from './play-client.ts';
import type { PlayMoneyUnits } from '../types/google/monetization.ts';

/** Minimal valid service-account JSON for adapter construction. */
function makeServiceAccountJson(): string {
  return JSON.stringify({
    type: 'service_account',
    client_email: 'launch@proj.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
    private_key_id: 'kid-123',
    token_uri: 'https://oauth2.googleapis.com/token',
  });
}
const insertEdit = vi.fn();
const commitEdit = vi.fn();
const deleteEdit = vi.fn();
const listBundles = vi.fn();
const uploadBundle = vi.fn();
const getTrack = vi.fn();
const listTracks = vi.fn();
const updateTrack = vi.fn();
const getTesters = vi.fn();
const updateTesters = vi.fn();
const getCountryAvailability = vi.fn();
const listListings = vi.fn();
const patchListing = vi.fn();
const listInAppProducts = vi.fn();
const insertInAppProduct = vi.fn();
const updateInAppProduct = vi.fn();
const convertRegionPrices = vi.fn();
const listSubscriptions = vi.fn();
const createSubscription = vi.fn();
const patchSubscription = vi.fn();
const activateBasePlan = vi.fn();
const listOffers = vi.fn();
const createOffer = vi.fn();
const activateOffer = vi.fn();
const listReviews = vi.fn();
const getReview = vi.fn();
const replyToReview = vi.fn();

/** Build the generated-client slice exercised by this adapter test. */
function generatedPublisherFake(): GooglePlayTransport {
  return {
    edits: {
      insert: insertEdit,
      commit: commitEdit,
      delete: deleteEdit,
      bundles: { list: listBundles, upload: uploadBundle },
      tracks: {
        get: getTrack,
        list: listTracks,
        update: updateTrack,
      },
      testers: { get: getTesters, update: updateTesters },
      countryavailability: { get: getCountryAvailability },
      listings: { list: listListings, patch: patchListing },
    },
    inappproducts: {
      list: listInAppProducts,
      insert: insertInAppProduct,
      update: updateInAppProduct,
    },
    monetization: {
      convertRegionPrices,
      subscriptions: {
        list: listSubscriptions,
        create: createSubscription,
        patch: patchSubscription,
        basePlans: {
          activate: activateBasePlan,
          offers: {
            list: listOffers,
            create: createOffer,
            activate: activateOffer,
          },
        },
      },
    },
    reviews: {
      list: listReviews,
      get: getReview,
      reply: replyToReview,
    },
  };
}

function openReadEdit(): void {
  insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
  deleteEdit.mockResolvedValue({ data: undefined });
}
let client: GooglePlayClient;

function prepare() {
  vi.clearAllMocks();
  const makeServiceAccount = makeServiceAccountJson();
  const serviceAccount = parseServiceAccount(makeServiceAccount);
  client = new GooglePlayClient(serviceAccount, generatedPublisherFake());
}

beforeEach(prepare);

function describeParseServiceAccount() {
  function extractsTheFieldsLaunchNeedsFromAValidKey() {
    const makeServiceAccount = makeServiceAccountJson();
    const account = parseServiceAccount(makeServiceAccount);

    expect(account.clientEmail).toBe('launch@proj.iam.gserviceaccount.com');
    expect(account.privateKey).toContain('PRIVATE KEY');
    expect(account.tokenUri).toBe('https://oauth2.googleapis.com/token');
    expect(account.privateKeyId).toBe('kid-123');
    expect(client.serviceAccountEmail).toBe('launch@proj.iam.gserviceaccount.com');
  }

  it(
    'extracts the fields Launch needs from a valid key',
    extractsTheFieldsLaunchNeedsFromAValidKey,
  );

  function defaultsTheTokenEndpointWhenAbsent() {
    const serialized = JSON.stringify({
      client_email: 'a@b.iam',
      private_key: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
    });
    const account = parseServiceAccount(serialized);

    expect(account.tokenUri).toBe('https://oauth2.googleapis.com/token');
  }

  it('defaults the token endpoint when absent', defaultsTheTokenEndpointWhenAbsent);

  function rejectsNonJSONAndTheWrongKeyKindWithActionablePiece() {
    let invalidJson: unknown;

    try {
      parseServiceAccount('not json');
    } catch (error) {
      invalidJson = error;
    }

    expect(invalidJson).toMatchObject({
      _tag: 'ServiceAccountParseError',
      message: expect.stringMatching(/not valid JSON/),
    });

    let wrongKind: unknown;

    try {
      const serialized = JSON.stringify({ type: 'authorized_user' });
      parseServiceAccount(serialized);
    } catch (error) {
      wrongKind = error;
    }

    expect(wrongKind).toMatchObject({
      _tag: 'ServiceAccountParseError',
      message: expect.stringMatching(/client_email.*private_key/),
    });
  }

  it(
    'rejects non-JSON and the wrong key kind with actionable text',
    rejectsNonJSONAndTheWrongKeyKindWithActionablePiece,
  );
}

describe('parseServiceAccount', describeParseServiceAccount);

function describeServiceAccountJwtPieceNonEmptyPageToken() {
  function copiesTheKeyIdWhenPresentAndDropsEmptyPageTokens() {
    const makeServiceAccount = makeServiceAccountJson();
    const account = parseServiceAccount(makeServiceAccount);
    const serviceAccountJwt = serviceAccountJwtOptions(account, ['scope-a']);

    expect(serviceAccountJwt).toEqual({
      email: 'launch@proj.iam.gserviceaccount.com',
      key: account.privateKey,
      keyId: 'kid-123',
      scopes: ['scope-a'],
    });
    expect(nonEmptyPageToken(undefined)).toBeUndefined();
    expect(nonEmptyPageToken('')).toBeUndefined();
    expect(nonEmptyPageToken('next')).toBe('next');
  }

  it(
    'copies the key id when present and drops empty page tokens',
    copiesTheKeyIdWhenPresentAndDropsEmptyPageTokens,
  );
}

describe(
  'serviceAccountJwtOptions / nonEmptyPageToken',
  describeServiceAccountJwtPieceNonEmptyPageToken,
);

function describeDescribePlayErrors() {
  function extractsGoogleSErrorMessage() {
    const serialized = JSON.stringify({ error: { message: 'The app was not found.' } });
    const playErrors = describePlayErrors(serialized);
    expect(playErrors).toBe('The app was not found.');
  }

  it("extracts Google's error message", extractsGoogleSErrorMessage);

  function flagsASensitivePermissionRejectionWithTheFix() {
    const errorText = JSON.stringify({
      error: { message: 'Your app uses a sensitive permission.' },
    });
    const playErrors = describePlayErrors(errorText);

    expect(playErrors).toMatch(/Permissions Declaration/);

    const genericPermissionErrorText = JSON.stringify({
      error: { message: 'The caller does not have permission' },
    });

    expect(describePlayErrors(genericPermissionErrorText)).toBe(
      'The caller does not have permission',
    );
  }

  it(
    'flags a sensitive-permission rejection with the fix',
    flagsASensitivePermissionRejectionWithTheFix,
  );

  function fallsBackAcrossStringErrorDescriptionPiecePieceThenEmptyPlaceholder() {
    const serialized = JSON.stringify({ error: 'quota exceeded' });
    const playErrors = describePlayErrors(serialized);

    expect(playErrors).toBe('quota exceeded');
    expect(describePlayErrors(JSON.stringify({ error_description: 'invalid_grant' }))).toBe(
      'invalid_grant',
    );
    expect(describePlayErrors('plain failure')).toBe('plain failure');
    expect(describePlayErrors('')).toBe('no response body');
  }

  it(
    'falls back across string error, description, raw text, then empty placeholder',
    fallsBackAcrossStringErrorDescriptionPiecePieceThenEmptyPlaceholder,
  );
}

describe('describePlayErrors', describeDescribePlayErrors);

function describeGooglePlayClientGeneratedReads() {
  async function returnsTheHighestUploadedVersionCodeAndAbandonsTheReadEdit() {
    openReadEdit();
    listBundles.mockResolvedValue({
      data: { bundles: [{ versionCode: 3 }, { versionCode: 7 }] },
    });
    expect(await client.getLatestVersionCode('com.example.hello')).toBe(7);
    expect(insertEdit).toHaveBeenCalledWith({ packageName: 'com.example.hello' });
    expect(listBundles).toHaveBeenCalledWith({
      packageName: 'com.example.hello',
      editId: 'edit1',
    });
    expect(deleteEdit).toHaveBeenCalledWith({
      packageName: 'com.example.hello',
      editId: 'edit1',
    });
  }

  it(
    'returns the highest uploaded version code and abandons the read edit',
    returnsTheHighestUploadedVersionCodeAndAbandonsTheReadEdit,
  );

  async function reportsZeroWhenNoBundlesHaveBeenUploaded() {
    openReadEdit();
    listBundles.mockResolvedValue({ data: {} });
    expect(await client.getLatestVersionCode('com.example.fresh')).toBe(0);
  }

  it('reports zero when no bundles have been uploaded', reportsZeroWhenNoBundlesHaveBeenUploaded);

  async function raisesPlayAppNotFoundErrorWhenEditCreationReportsAMissingApp() {
    insertEdit.mockRejectedValue(
      Object.assign(new Error('Application not found.'), { status: 404 }),
    );
    await expect(client.assertAppExists('com.example.missing')).rejects.toMatchObject({
      _tag: 'PlayAppNotFoundError',
    });
  }

  it(
    'raises PlayAppNotFoundError when edit creation reports a missing app',
    raisesPlayAppNotFoundErrorWhenEditCreationReportsAMissingApp,
  );

  async function normalizesTrackReleasesAndTesterGroupsInsideAThrowawayEdit() {
    openReadEdit();
    getTrack.mockResolvedValue({
      data: {
        releases: [
          {
            name: '1.2.0',
            versionCodes: ['12'],
            status: 'inProgress',
            userFraction: 0.1,
            releaseNotes: [{ language: 'en-US', text: 'fixes' }],
          },
        ],
      },
    });
    getTesters.mockResolvedValue({ data: { googleGroups: ['qa@example.com'] } });
    getCountryAvailability.mockResolvedValue({
      data: {
        countries: [{ countryCode: 'US' }, { countryCode: 1 }],
        restOfWorld: true,
      },
    });
    expect(await client.getTrackReleases('com.example.app', 'beta')).toEqual([
      {
        name: '1.2.0',
        versionCodes: ['12'],
        status: 'inProgress',
        userFraction: 0.1,
        releaseNotes: [{ language: 'en-US', text: 'fixes' }],
      },
    ]);
    expect(await client.getTesters('com.example.app', 'beta')).toEqual(['qa@example.com']);
    expect(await client.getCountryAvailability('com.example.app', 'production')).toEqual({
      countries: [{ countryCode: 'US' }],
      restOfWorld: true,
    });
  }

  it(
    'normalizes track releases and tester groups inside a throwaway edit',
    normalizesTrackReleasesAndTesterGroupsInsideAThrowawayEdit,
  );

  async function listsEveryTrackWithNormalizedReleases() {
    openReadEdit();
    listTracks.mockResolvedValue({
      data: {
        tracks: [
          { track: 'internal', releases: [{ name: '1.0.0', status: 'completed' }] },
          { track: 12 },
          { track: 'production', releases: null },
        ],
      },
    });
    expect(await client.listTracks('com.example.app')).toEqual([
      {
        track: 'internal',
        releases: [{ name: '1.0.0', status: 'completed' }],
      },
      { track: 'production', releases: [] },
    ]);
  }

  it('lists every track with normalized releases', listsEveryTrackWithNormalizedReleases);

  async function sendsTheCallerFieldSelectorOnATrackList() {
    openReadEdit();
    listTracks.mockResolvedValue({ data: { tracks: [] } });

    await client.listTracks('com.example.app', 'tracks(track)');

    expect(listTracks).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      editId: 'edit1',
      fields: 'tracks(track)',
    });
  }

  it('sends the caller field selector on a track list', sendsTheCallerFieldSelectorOnATrackList);
}

describe('GooglePlayClient generated reads', describeGooglePlayClientGeneratedReads);

function describeGooglePlayClientWithEdit() {
  async function opensAnEditAppliesTheWriteThenCommits() {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    commitEdit.mockResolvedValue({ data: {} });

    async function returnEditId(editId: string): Promise<string> {
      return editId;
    }

    const appliedEditId = await client.withEdit('com.example.app', returnEditId);

    expect(appliedEditId).toBe('edit1');
    expect(commitEdit).toHaveBeenCalledWith({ packageName: 'com.example.app', editId: 'edit1' });
    expect(deleteEdit).not.toHaveBeenCalled();
  }

  it('opens an edit, applies the write, then commits', opensAnEditAppliesTheWriteThenCommits);

  async function abandonsTheEditWhenTheWriteFails() {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    deleteEdit.mockResolvedValue({ data: undefined });

    async function failWrite(): Promise<void> {
      throw new Error('boom');
    }

    await expect(client.withEdit('com.example.app', failWrite)).rejects.toThrow('boom');
    expect(commitEdit).not.toHaveBeenCalled();
    expect(deleteEdit).toHaveBeenCalledWith({ packageName: 'com.example.app', editId: 'edit1' });
  }

  it('abandons the edit when the write fails', abandonsTheEditWhenTheWriteFails);

  async function commitsSetTrackReleasesAndSetTestersInsideOneEditEach() {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    commitEdit.mockResolvedValue({ data: {} });
    updateTrack.mockResolvedValue({ data: {} });
    updateTesters.mockResolvedValue({ data: {} });
    await client.setTrackReleases('com.example.app', 'production', [
      { name: '2.0.0', versionCodes: ['20'], status: 'completed' },
    ]);
    await client.setTesters('com.example.app', 'internal', ['group@x.com']);
    expect(updateTrack).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      editId: 'edit1',
      track: 'production',
      requestBody: {
        track: 'production',
        releases: [{ name: '2.0.0', versionCodes: ['20'], status: 'completed' }],
      },
    });
    expect(updateTesters).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      editId: 'edit1',
      track: 'internal',
      requestBody: { googleGroups: ['group@x.com'] },
    });
    expect(commitEdit).toHaveBeenCalledTimes(2);
  }

  it(
    'commits setTrackReleases and setTesters inside one edit each',
    commitsSetTrackReleasesAndSetTestersInsideOneEditEach,
  );

  async function uploadsABundleAndReleasesItsVersionCodeOnTheTrackInOneEdit() {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    commitEdit.mockResolvedValue({ data: {} });
    uploadBundle.mockResolvedValue({ data: { versionCode: 31 } });
    updateTrack.mockResolvedValue({ data: {} });

    const bufferBytes = Buffer.from([1, 2, 3]);
    const bundleStream = Readable.from([bufferBytes]);
    const versionCode = await client.uploadBundleToTrack('com.example.app', bundleStream, 'beta', {
      status: 'inProgress',
      userFraction: 0.2,
    });

    expect(versionCode).toBe(31);
    expect(uploadBundle).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      editId: 'edit1',
      media: { mimeType: 'application/octet-stream', body: bundleStream },
    });
    expect(updateTrack).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      editId: 'edit1',
      track: 'beta',
      requestBody: {
        track: 'beta',
        releases: [{ status: 'inProgress', userFraction: 0.2, versionCodes: ['31'] }],
      },
    });
    expect(commitEdit).toHaveBeenCalledTimes(1);
  }

  it(
    'uploads a bundle and releases its version code on the track in one edit',
    uploadsABundleAndReleasesItsVersionCodeOnTheTrackInOneEdit,
  );

  async function abandonsTheEditWhenTheUploadedBundleHasNoVersionCode() {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    deleteEdit.mockResolvedValue({ data: undefined });
    uploadBundle.mockResolvedValue({ data: {} });

    const bufferBytes = Buffer.from([1]);

    await expect(
      client.uploadBundleToTrack('com.example.app', Readable.from([bufferBytes]), 'internal', {
        status: 'completed',
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/returned no versionCode/),
    });
    expect(updateTrack).not.toHaveBeenCalled();
    expect(commitEdit).not.toHaveBeenCalled();
    expect(deleteEdit).toHaveBeenCalledWith({ packageName: 'com.example.app', editId: 'edit1' });
  }

  it(
    'abandons the edit when the uploaded bundle has no version code',
    abandonsTheEditWhenTheUploadedBundleHasNoVersionCode,
  );
}

describe('GooglePlayClient.withEdit', describeGooglePlayClientWithEdit);

function describeGooglePlayClientStoreListings() {
  async function listsTheLocalizedListingsAndDropsEntriesWithoutALanguage() {
    openReadEdit();
    listListings.mockResolvedValue({
      data: {
        listings: [
          {
            language: 'en-US',
            title: 'Hello',
            shortDescription: 'short',
            fullDescription: 'full',
            video: 'https://youtu.be/x',
          },
          { language: 'de-DE', title: 'Hallo', shortDescription: null },
          { title: 'no language' },
        ],
      },
    });
    expect(await client.listListings('com.example.app')).toEqual([
      {
        language: 'en-US',
        title: 'Hello',
        shortDescription: 'short',
        fullDescription: 'full',
        video: 'https://youtu.be/x',
      },
      { language: 'de-DE', title: 'Hallo' },
    ]);
    expect(listListings).toHaveBeenCalledWith({ packageName: 'com.example.app', editId: 'edit1' });
    expect(deleteEdit).toHaveBeenCalledWith({ packageName: 'com.example.app', editId: 'edit1' });
    expect(commitEdit).not.toHaveBeenCalled();
  }

  it(
    'lists the localized listings and drops entries without a language',
    listsTheLocalizedListingsAndDropsEntriesWithoutALanguage,
  );

  async function returnsNoListingsWhenTheAppHasNone() {
    openReadEdit();
    listListings.mockResolvedValue({ data: {} });
    expect(await client.listListings('com.example.app')).toEqual([]);
  }

  it('returns no listings when the app has none', returnsNoListingsWhenTheAppHasNone);

  async function patchesEveryLanguageInsideOneCommittedEdit() {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    commitEdit.mockResolvedValue({ data: {} });
    patchListing.mockResolvedValue({ data: {} });
    await client.updateListings('com.example.app', [
      { language: 'en-US', title: 'Hello', shortDescription: 'short' },
      { language: 'de-DE', fullDescription: 'voll' },
    ]);
    expect(patchListing).toHaveBeenCalledTimes(2);
    expect(patchListing).toHaveBeenNthCalledWith(1, {
      packageName: 'com.example.app',
      editId: 'edit1',
      language: 'en-US',
      requestBody: { language: 'en-US', title: 'Hello', shortDescription: 'short' },
    });
    expect(patchListing).toHaveBeenNthCalledWith(2, {
      packageName: 'com.example.app',
      editId: 'edit1',
      language: 'de-DE',
      requestBody: { language: 'de-DE', fullDescription: 'voll' },
    });
    expect(insertEdit).toHaveBeenCalledTimes(1);
    expect(commitEdit).toHaveBeenCalledTimes(1);
  }

  it(
    'patches every language inside one committed edit',
    patchesEveryLanguageInsideOneCommittedEdit,
  );

  async function abandonsTheEditWhenAListingPatchFails() {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    deleteEdit.mockResolvedValue({ data: undefined });
    patchListing.mockRejectedValue(Object.assign(new Error('bad title'), { status: 400 }));
    await expect(
      client.updateListings('com.example.app', [{ language: 'en-US', title: '' }]),
    ).rejects.toMatchObject({ _tag: 'GooglePlayApiError', statusCode: 400 });
    expect(commitEdit).not.toHaveBeenCalled();
    expect(deleteEdit).toHaveBeenCalledWith({ packageName: 'com.example.app', editId: 'edit1' });
  }

  it('abandons the edit when a listing patch fails', abandonsTheEditWhenAListingPatchFails);
}

describe('GooglePlayClient store listings', describeGooglePlayClientStoreListings);

function describeGooglePlayClientConvertRegionPrices() {
  async function normalizesGeneratedPricesIntoSortedRegionsAndFallbackMoney() {
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

    const convertedPrices = await client.convertRegionPrices('com.example.app', {
      currencyCode: 'USD',
      units: '4',
      nanos: 990000000,
    });

    expect(convertRegionPrices).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      requestBody: {
        price: { currencyCode: 'USD', units: '4', nanos: 990000000 },
      },
    });

    function readRegionCode(regionPrice: {
      readonly regionCode: string;
      readonly price: PlayMoneyUnits;
    }) {
      return regionPrice.regionCode;
    }

    expect(convertedPrices.regions.map(readRegionCode)).toEqual(['DE', 'JP', 'US']);
    expect(convertedPrices.regions[2]).toEqual({
      regionCode: 'US',
      price: { currencyCode: 'USD', units: '4', nanos: 990000000 },
    });
    expect(convertedPrices.otherRegions?.usdPrice.units).toBe('4');
    expect(convertedPrices.otherRegions?.eurPrice.currencyCode).toBe('EUR');
  }

  it(
    'normalizes generated prices into sorted regions and fallback money',
    normalizesGeneratedPricesIntoSortedRegionsAndFallbackMoney,
  );

  async function dropsMissingRegionCodesFillsMissingMoneyFieldsAndOmitsAbsentFallback() {
    convertRegionPrices.mockResolvedValue({
      data: {
        convertedRegionPrices: {
          GB: { regionCode: 'GB', price: { currencyCode: 'GBP' } },
          missing: { price: { currencyCode: 'USD', units: '1', nanos: 0 } },
        },
      },
    });

    const convertedPrices = await client.convertRegionPrices('com.example.app', {
      currencyCode: 'USD',
      units: '1',
      nanos: 0,
    });

    expect(convertedPrices.regions).toEqual([
      { regionCode: 'GB', price: { currencyCode: 'GBP', units: '0', nanos: 0 } },
    ]);
    expect(convertedPrices.otherRegions).toBeUndefined();
  }

  it(
    'drops missing region codes, fills missing money fields, and omits absent fallback',
    dropsMissingRegionCodesFillsMissingMoneyFieldsAndOmitsAbsentFallback,
  );

  async function passesTheOptionalProductTaxCategoryToTheGeneratedRequest() {
    convertRegionPrices.mockResolvedValue({ data: { convertedRegionPrices: {} } });
    await client.convertRegionPrices(
      'com.example.app',
      { currencyCode: 'USD', units: '4', nanos: 0 },
      'TAX_CATEGORY',
    );
    expect(convertRegionPrices).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      requestBody: {
        price: { currencyCode: 'USD', units: '4', nanos: 0 },
        productTaxCategoryCode: 'TAX_CATEGORY',
      },
    });
  }

  it(
    'passes the optional product tax category to the generated request',
    passesTheOptionalProductTaxCategoryToTheGeneratedRequest,
  );
}

describe('GooglePlayClient.convertRegionPrices', describeGooglePlayClientConvertRegionPrices);

function describeGooglePlayClientCatalogReviews() {
  async function pagesInAppProductsAndNormalizesMoneyListings() {
    listInAppProducts
      .mockResolvedValueOnce({
        data: {
          inappproduct: [
            {
              sku: 'coins',
              status: 'active',
              purchaseType: 'managedUser',
              defaultLanguage: 'en-US',
              defaultPrice: { priceMicros: '1990000', currency: 'USD' },
              prices: { US: { priceMicros: '1990000', currency: 'USD' } },
              listings: {
                'en-US': { title: 'Coins', description: 'Pack' },
              },
            },
            { status: 'active' },
          ],
          tokenPagination: { nextPageToken: 'page-2' },
        },
      })
      .mockResolvedValueOnce({
        data: {
          inappproduct: [{ sku: 'gems', status: 'active' }],
        },
      });
    expect(await client.listInAppProducts('com.example.app')).toEqual([
      {
        sku: 'coins',
        status: 'active',
        purchaseType: 'managedUser',
        defaultLanguage: 'en-US',
        defaultPrice: { priceMicros: '1990000', currency: 'USD' },
        prices: { US: { priceMicros: '1990000', currency: 'USD' } },
        listings: { 'en-US': { title: 'Coins', description: 'Pack' } },
      },
      { sku: 'gems', status: 'active' },
    ]);
    expect(listInAppProducts).toHaveBeenCalledTimes(2);
    expect(listInAppProducts.mock.calls[1]?.[0].token).toBe('page-2');
  }

  it(
    'pages in-app products and normalizes money/listings',
    pagesInAppProductsAndNormalizesMoneyListings,
  );

  async function writesInAppProductsAndSubscriptionsThroughTheGeneratedClient() {
    insertInAppProduct.mockResolvedValue({ data: {} });
    updateInAppProduct.mockResolvedValue({ data: {} });
    createSubscription.mockResolvedValue({ data: {} });
    patchSubscription.mockResolvedValue({ data: {} });
    activateBasePlan.mockResolvedValue({ data: {} });
    createOffer.mockResolvedValue({ data: {} });
    activateOffer.mockResolvedValue({ data: {} });
    await client.insertInAppProduct('com.example.app', { sku: 'coins', status: 'active' });
    await client.updateInAppProduct('com.example.app', { sku: 'coins', status: 'active' });
    await client.createSubscription('com.example.app', {
      productId: 'pro',
      listings: [{ languageCode: 'en-US', title: 'Pro', description: 'All features' }],
    });
    await client.patchSubscription(
      'com.example.app',
      {
        productId: 'pro',
        listings: [{ languageCode: 'en-US', title: 'Pro', description: 'All' }],
      },
      'listings',
    );
    await client.activateBasePlan('com.example.app', 'pro', 'p1m');
    await client.createSubscriptionOffer('com.example.app', {
      offerId: 'trial',
      productId: 'pro',
      basePlanId: 'p1m',
      phases: [],
      regionalConfigs: [],
    });
    await client.activateSubscriptionOffer('com.example.app', 'pro', 'p1m', 'trial');
    expect(insertInAppProduct).toHaveBeenCalled();
    expect(updateInAppProduct.mock.calls[0]?.[0].sku).toBe('coins');
    expect(createSubscription.mock.calls[0]?.[0].productId).toBe('pro');
    expect(patchSubscription.mock.calls[0]?.[0].updateMask).toBe('listings');
    expect(activateBasePlan).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      productId: 'pro',
      basePlanId: 'p1m',
      requestBody: { packageName: 'com.example.app', productId: 'pro', basePlanId: 'p1m' },
    });
    expect(createOffer.mock.calls[0]?.[0].offerId).toBe('trial');
    expect(activateOffer.mock.calls[0]?.[0].offerId).toBe('trial');
  }

  it(
    'writes in-app products and subscriptions through the generated client',
    writesInAppProductsAndSubscriptionsThroughTheGeneratedClient,
  );

  async function pagesSubscriptionsAndOffersDroppingIncompleteGeneratedDocuments() {
    listSubscriptions
      .mockResolvedValueOnce({
        data: {
          subscriptions: [
            {
              productId: 'pro',
              packageName: 'com.example.app',
              basePlans: [
                {
                  basePlanId: 'p1m',
                  state: 'ACTIVE',
                  autoRenewingBasePlanType: { billingPeriodDuration: 'P1M' },
                  regionalConfigs: [
                    {
                      regionCode: 'US',
                      newSubscriberAvailability: true,
                      price: { currencyCode: 'USD', units: '9', nanos: 990000000 },
                    },
                  ],
                  offerTags: [{ tag: 'default' }, {}],
                },
              ],
              listings: [
                {
                  languageCode: 'en-US',
                  title: 'Pro',
                  description: 'All features',
                  benefits: ['No ads'],
                },
              ],
            },
            { packageName: 'com.example.app' },
          ],
          nextPageToken: 'subs-2',
        },
      })
      .mockResolvedValueOnce({ data: { subscriptions: [] } });
    listOffers.mockResolvedValue({
      data: {
        subscriptionOffers: [
          {
            offerId: 'trial',
            productId: 'pro',
            basePlanId: 'p1m',
            state: 'ACTIVE',
            regionalConfigs: [{ regionCode: 'US', newSubscriberAvailability: true }],
            phases: [
              {
                recurrenceCount: 1,
                duration: 'P1W',
                regionalConfigs: [{ regionCode: 'US', free: {} }],
              },
            ],
            offerTags: [{ tag: 'welcome' }],
          },
          { productId: 'pro' },
        ],
      },
    });
    expect(await client.listSubscriptions('com.example.app')).toEqual([
      {
        productId: 'pro',
        packageName: 'com.example.app',
        basePlans: [
          {
            basePlanId: 'p1m',
            state: 'ACTIVE',
            autoRenewingBasePlanType: { billingPeriodDuration: 'P1M' },
            regionalConfigs: [
              {
                regionCode: 'US',
                newSubscriberAvailability: true,
                price: { currencyCode: 'USD', units: '9', nanos: 990000000 },
              },
            ],
            offerTags: [{ tag: 'default' }],
          },
        ],
        listings: [
          {
            languageCode: 'en-US',
            title: 'Pro',
            description: 'All features',
            benefits: ['No ads'],
          },
        ],
      },
    ]);
    expect(listSubscriptions.mock.calls[1]?.[0].pageToken).toBe('subs-2');
    expect(await client.listSubscriptionOffers('com.example.app', 'pro', 'p1m')).toEqual([
      {
        offerId: 'trial',
        productId: 'pro',
        basePlanId: 'p1m',
        state: 'ACTIVE',
        regionalConfigs: [{ regionCode: 'US', newSubscriberAvailability: true }],
        phases: [
          {
            recurrenceCount: 1,
            duration: 'P1W',
            regionalConfigs: [{ regionCode: 'US', free: {} }],
          },
        ],
        offerTags: [{ tag: 'welcome' }],
      },
    ]);
  }

  it(
    'pages subscriptions and offers, dropping incomplete generated documents',
    pagesSubscriptionsAndOffersDroppingIncompleteGeneratedDocuments,
  );

  async function listsGetsAndRepliesToReviewsWithFlattenedFields() {
    listReviews.mockResolvedValue({
      data: {
        reviews: [
          {
            reviewId: 'r1',
            authorName: 'Alex',
            comments: [
              {
                userComment: {
                  text: 'Great app',
                  starRating: 5,
                  reviewerLanguage: 'en',
                  device: 'Pixel',
                  appVersionName: '1.2.0',
                  lastModified: { seconds: '1710000000' },
                },
              },
              { developerComment: { text: 'Thanks!' } },
            ],
          },
          { authorName: 'no-id' },
        ],
      },
    });
    getReview
      .mockResolvedValueOnce({
        data: {
          reviewId: 'r1',
          comments: [{ userComment: { text: 'Great app', starRating: 5 } }],
        },
      })
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { status: 404 }));
    replyToReview.mockResolvedValue({
      data: {
        result: {
          replyText: 'Thanks for the review!',
          lastEdited: { seconds: '1710000100' },
        },
      },
    });

    const reviews = await client.listReviews('com.example.app', { translationLanguage: 'en' });

    expect(reviews).toEqual([
      {
        reviewId: 'r1',
        authorName: 'Alex',
        rating: 5,
        text: 'Great app',
        reviewerLanguage: 'en',
        device: 'Pixel',
        appVersionName: '1.2.0',
        lastModified: new Date(1710000000 * 1000).toISOString(),
        answered: true,
        developerReply: 'Thanks!',
      },
    ]);
    expect(listReviews.mock.calls[0]?.[0].translationLanguage).toBe('en');
    expect(await client.getReview('com.example.app', 'r1')).toMatchObject({
      reviewId: 'r1',
      rating: 5,
      answered: false,
    });
    expect(await client.getReview('com.example.app', 'missing')).toBeNull();
    expect(await client.replyToReview('com.example.app', 'r1', 'Thanks!')).toEqual({
      replyText: 'Thanks for the review!',
      lastEdited: new Date(1710000100 * 1000).toISOString(),
    });
  }

  it(
    'lists, gets, and replies to reviews with flattened fields',
    listsGetsAndRepliesToReviewsWithFlattenedFields,
  );

  async function tagsGeneratedFailuresWithStatusAndOperationPiece() {
    const serialized = JSON.stringify({ error: { message: 'rate limited' } });

    listInAppProducts.mockRejectedValue(
      Object.assign(new Error(serialized), {
        status: 429,
      }),
    );
    await expect(client.listInAppProducts('com.example.app')).rejects.toMatchObject({
      _tag: 'GooglePlayApiError',
      operation: 'list in-app products',
      statusCode: 429,
      message: expect.stringMatching(/rate limited/),
    });
  }

  it(
    'tags generated failures with status and operation text',
    tagsGeneratedFailuresWithStatusAndOperationPiece,
  );
}

describe('GooglePlayClient catalog + reviews', describeGooglePlayClientCatalogReviews);
