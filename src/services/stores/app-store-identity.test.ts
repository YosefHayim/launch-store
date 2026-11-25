import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppStoreConnectClient } from '../../apple/app-store-connect-client.ts';
import { makeAppleTransportFailure, setAppleStoreClient } from './apple-store-client.ts';
import { AppStoreIdentityService } from './app-store-identity.ts';

const ascKey = { keyId: 'key', issuerId: 'issuer', p8: 'secret' };

const failure = makeAppleTransportFailure({
  message: 'Unauthorized',
  cause: new Error('Unauthorized'),
  status: 401,
});

afterEach(function resetAppleClient() {
  setAppleStoreClient(null);
});

function installClient(methods: {
  assertReady: () => Promise<void>;
  readTeamId: () => Promise<string | null>;
  listAppNames: () => Promise<string[]>;
}): void {
  setAppleStoreClient(function createClient() {
    const client = Object.create(AppStoreConnectClient.prototype);

    client.assertReady = methods.assertReady;
    client.readTeamId = methods.readTeamId;
    client.listAppNames = methods.listAppNames;

    return client;
  });
}

function describeAppStoreIdentityService() {
  async function verifiesTheKeyBeforeReturningItsBestEffortIdentity() {
    const assertReady = vi.fn(async function ready() {
      return undefined;
    });

    installClient({
      assertReady,
      readTeamId: async function readTeamId() {
        return 'TEAM1';
      },
      listAppNames: async function listAppNames() {
        return ['One', 'Two'];
      },
    });

    await expect(new AppStoreIdentityService().verifyCredentials(ascKey)).resolves.toEqual({
      teamId: 'TEAM1',
      apps: ['One', 'Two'],
    });
    expect(assertReady).toHaveBeenCalledOnce();
  }

  it(
    'verifies the key before returning its best-effort identity',
    verifiesTheKeyBeforeReturningItsBestEffortIdentity,
  );

  async function keepsVerificationFailuresInTheTypedErrorChannel() {
    installClient({
      assertReady: async function failReady() {
        throw failure;
      },
      readTeamId: async function readTeamId() {
        return 'TEAM1';
      },
      listAppNames: async function listAppNames() {
        return ['One'];
      },
    });

    await expect(new AppStoreIdentityService().verifyCredentials(ascKey)).rejects.toMatchObject({
      _tag: 'AppleTransportFailure',
      status: 401,
    });
  }

  it(
    'keeps verification failures in the typed error channel',
    keepsVerificationFailuresInTheTypedErrorChannel,
  );

  async function doesNotRejectAVerifiedKeyWhenIdentityDiscoveryIsUnavailable() {
    installClient({
      assertReady: async function ready() {
        return undefined;
      },
      readTeamId: async function failTeam() {
        throw failure;
      },
      listAppNames: async function failApps() {
        throw failure;
      },
    });

    await expect(new AppStoreIdentityService().verifyCredentials(ascKey)).resolves.toEqual({
      teamId: null,
      apps: [],
    });
  }

  it(
    'does not reject a verified key when identity discovery is unavailable',
    doesNotRejectAVerifiedKeyWhenIdentityDiscoveryIsUnavailable,
  );
}

describe('AppStoreIdentityService', describeAppStoreIdentityService);
