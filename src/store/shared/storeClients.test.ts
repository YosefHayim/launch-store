import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStoreConnectClient } from '../../apple/ascClient.ts';
import { GooglePlayClient, type GooglePlayTransport } from '../../google/playClient.ts';
import { loadActiveAscKey } from '../../credentials/accounts.ts';
import { loadServiceAccount } from '../../credentials/androidKeystore.ts';
import { AppleStoreClientService } from '../../services/stores/appleStoreClient.ts';
import { GoogleStoreClientService } from '../../services/stores/googleStoreClient.ts';
import { createAscClientResolver, createPlayClientResolver } from './storeClients.ts';
vi.mock('../../credentials/accounts.ts', () => ({ loadActiveAscKey: vi.fn() }));
vi.mock('../../credentials/androidKeystore.ts', () => ({ loadServiceAccount: vi.fn() }));

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createAscClientResolver', () => {
  it('loads credentials and constructs the client once', async () => {
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
  });

  it('caches an unconfigured account without creating a client', async () => {
    vi.mocked(loadActiveAscKey).mockResolvedValue(null);
    const createClient = vi
      .spyOn(AppleStoreClientService, 'createEffectClient')
      .mockReturnValue(appStoreClient);
    const resolveAppStoreClient = createAscClientResolver();

    expect(await resolveAppStoreClient()).toBeNull();
    expect(await resolveAppStoreClient()).toBeNull();
    expect(loadActiveAscKey).toHaveBeenCalledTimes(1);
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('createPlayClientResolver', () => {
  it('loads the service account and constructs the client once', async () => {
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
  });

  it('caches an unconfigured account without creating a client', async () => {
    vi.mocked(loadServiceAccount).mockResolvedValue(null);
    const createClient = vi
      .spyOn(GoogleStoreClientService, 'createEffectClient')
      .mockReturnValue(playStoreClient);
    const resolvePlayStoreClient = createPlayClientResolver();

    expect(await resolvePlayStoreClient('com.example.demo')).toBeNull();
    expect(await resolvePlayStoreClient('com.example.demo')).toBeNull();
    expect(loadServiceAccount).toHaveBeenCalledTimes(1);
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('per-package Play client resolution', () => {
  it('loads each package account independently instead of reusing the first app account', async () => {
    vi.mocked(loadServiceAccount).mockImplementation(function accountJson(packageName: string) {
      return Promise.resolve(JSON.stringify({ packageName }));
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
    expect(createClient).toHaveBeenCalledWith(JSON.stringify({ packageName: 'com.example.alpha' }));
    expect(createClient).toHaveBeenCalledWith(JSON.stringify({ packageName: 'com.example.beta' }));
    expect(await resolvePackageClient()).toBeNull();
  });
});
