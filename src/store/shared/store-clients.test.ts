import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStoreConnectClient } from '@/apple/asc-client.js';
import { GooglePlayClient, type GooglePlayTransport } from '@/google/play-client.js';
import { loadActiveAscKey } from '@/credentials/accounts.js';
import { loadServiceAccount } from '@/credentials/android-keystore-assets.js';
import { AppleStoreClientService } from '@/services/stores/apple-store-client.js';
import { GoogleStoreClientService } from '@/services/stores/google-store-client.js';
import { createAscClientResolver, createPlayClientResolver } from './store-clients.ts';
vi.mock('@/credentials/accounts.js', function mockAccounts() {
  return { loadActiveAscKey: vi.fn() };
});
vi.mock('@/credentials/android-keystore-assets.js', function mockAndroidKeystoreAssets() {
  return { loadServiceAccount: vi.fn() };
});

function playTransport(): GooglePlayTransport {
  return {
    edits: {
      insert: vi.fn(),
      commit: vi.fn(),
      delete: vi.fn(),
      bundles: { list: vi.fn(), upload: vi.fn() },
      tracks: { get: vi.fn(), list: vi.fn(), update: vi.fn() },
      testers: { get: vi.fn(), update: vi.fn() },
      countryavailability: { get: vi.fn() },
      listings: { list: vi.fn(), patch: vi.fn() },
    },
    inappproducts: {
      list: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
    },
    monetization: {
      convertRegionPrices: vi.fn(),
      subscriptions: {
        list: vi.fn(),
        create: vi.fn(),
        patch: vi.fn(),
        basePlans: {
          activate: vi.fn(),
          offers: {
            list: vi.fn(),
            create: vi.fn(),
            activate: vi.fn(),
          },
        },
      },
    },
    reviews: {
      list: vi.fn(),
      get: vi.fn(),
      reply: vi.fn(),
    },
  };
}

const appStoreClient = new AppStoreConnectClient({
  keyId: 'K',
  issuerId: 'I',
  p8: 'pem',
});
const playStoreClient = new GooglePlayClient(
  {
    clientEmail: 'launch@example.com',
    privateKey: 'unused',
    tokenUri: 'https://oauth2.googleapis.com/token',
  },
  playTransport(),
);
function prepare() {
  vi.clearAllMocks();
}

beforeEach(prepare);
function describeCreateAscClientResolver() {
  async function loadsCredentialsAndConstructsTheClientOnce() {
    vi.mocked(loadActiveAscKey).mockResolvedValue({ keyId: 'K', issuerId: 'I', p8: 'pem' });

    const createClient = vi
      .spyOn(AppleStoreClientService, 'createEffectClient')
      .mockReturnValue(appStoreClient);
    const resolveAppStoreClient = createAscClientResolver();

    const firstClient = await resolveAppStoreClient();
    const secondClient = await resolveAppStoreClient();

    expect(firstClient).toBe(secondClient);
    expect(loadActiveAscKey).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledTimes(1);
  }

  it(
    'loads credentials and constructs the client once',
    loadsCredentialsAndConstructsTheClientOnce,
  );

  async function cachesAnUnconfiguredAccountWithoutCreatingAClient() {
    vi.mocked(loadActiveAscKey).mockResolvedValue(null);

    const createClient = vi
      .spyOn(AppleStoreClientService, 'createEffectClient')
      .mockReturnValue(appStoreClient);
    const resolveAppStoreClient = createAscClientResolver();

    expect(await resolveAppStoreClient()).toBeNull();
    expect(await resolveAppStoreClient()).toBeNull();
    expect(loadActiveAscKey).toHaveBeenCalledTimes(1);
    expect(createClient).not.toHaveBeenCalled();
  }

  it(
    'caches an unconfigured account without creating a client',
    cachesAnUnconfiguredAccountWithoutCreatingAClient,
  );
}

describe('createAscClientResolver', describeCreateAscClientResolver);
function describeCreatePlayClientResolver() {
  async function loadsTheServiceAccountAndConstructsTheClientOnce() {
    vi.mocked(loadServiceAccount).mockResolvedValue('{}');

    const createClient = vi
      .spyOn(GoogleStoreClientService, 'createEffectClient')
      .mockReturnValue(playStoreClient);
    const resolvePlayStoreClient = createPlayClientResolver();

    const firstClient = await resolvePlayStoreClient('com.example.demo');
    const secondClient = await resolvePlayStoreClient('com.example.demo');

    expect(firstClient).toBe(secondClient);
    expect(loadServiceAccount).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledTimes(1);
  }

  it(
    'loads the service account and constructs the client once',
    loadsTheServiceAccountAndConstructsTheClientOnce,
  );

  async function cachesAnUnconfiguredAccountWithoutCreatingAClient2() {
    vi.mocked(loadServiceAccount).mockResolvedValue(null);

    const createClient = vi
      .spyOn(GoogleStoreClientService, 'createEffectClient')
      .mockReturnValue(playStoreClient);
    const resolvePlayStoreClient = createPlayClientResolver();

    expect(await resolvePlayStoreClient('com.example.demo')).toBeNull();
    expect(await resolvePlayStoreClient('com.example.demo')).toBeNull();
    expect(loadServiceAccount).toHaveBeenCalledTimes(1);
    expect(createClient).not.toHaveBeenCalled();
  }

  it(
    'caches an unconfigured account without creating a client',
    cachesAnUnconfiguredAccountWithoutCreatingAClient2,
  );
}

describe('createPlayClientResolver', describeCreatePlayClientResolver);
function describePerPackagePlayClientResolution() {
  async function loadsEachPackageAccountIndependentlyInsteadOfReusingTheFirstAppAccount() {
    vi.mocked(loadServiceAccount).mockImplementation(function accountJson(packageName: string) {
      const serialized = JSON.stringify({ packageName });
      return Promise.resolve(serialized);
    });

    const createClient = vi
      .spyOn(GoogleStoreClientService, 'createEffectClient')
      .mockReturnValue(playStoreClient);
    const resolvePackageClient = createPlayClientResolver();

    await resolvePackageClient('com.example.alpha');
    await resolvePackageClient('com.example.beta');
    await resolvePackageClient('com.example.alpha');

    expect(loadServiceAccount).toHaveBeenCalledTimes(2);
    expect(loadServiceAccount).toHaveBeenCalledWith('com.example.alpha');
    expect(loadServiceAccount).toHaveBeenCalledWith('com.example.beta');

    const serialized = JSON.stringify({ packageName: 'com.example.alpha' });

    expect(createClient).toHaveBeenCalledWith(serialized);
    expect(createClient).toHaveBeenCalledWith(JSON.stringify({ packageName: 'com.example.beta' }));

    const packageClient = await resolvePackageClient();

    expect(packageClient).toBeNull();
  }

  it(
    'loads each package account independently instead of reusing the first app account',
    loadsEachPackageAccountIndependentlyInsteadOfReusingTheFirstAppAccount,
  );
}

describe('per-package Play client resolution', describePerPackagePlayClientResolution);
