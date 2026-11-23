import { afterEach, describe, expect, test } from 'vitest';
import type { ServiceAccount } from '../../types/credentials.ts';
import {
  GoogleAccessToken,
  resetGoogleAccessToken,
  useGoogleAccessTokenFixture,
} from './google-access-token.ts';

const SERVICE_ACCOUNT: ServiceAccount = {
  clientEmail: 'robot@project.iam.gserviceaccount.com',
  privateKey: 'not-a-real-key',
  tokenUri: 'http://127.0.0.1:1/token',
};

afterEach(function resetAccessToken() {
  resetGoogleAccessToken();
});
function describeGoogleAccessToken() {
  async function readsEveryKeyAsTheGivenServiceAccountAndReturnsTheGivenToken() {
    useGoogleAccessTokenFixture(SERVICE_ACCOUNT, 'token-1');

    const account = GoogleAccessToken.readServiceAccount('{}');
    const token = await GoogleAccessToken.createAccessToken(account, ['scope']);

    expect({ account, token }).toEqual({ account: SERVICE_ACCOUNT, token: 'token-1' });
  }

  test(
    'reads every key as the given service account and returns the given token',
    readsEveryKeyAsTheGivenServiceAccountAndReturnsTheGivenToken,
  );
  function turnsPieceThatIsNotAServiceAccountIntoAFailure() {
    let failure: unknown = null;

    try {
      GoogleAccessToken.readServiceAccount('not json');
    } catch (caught) {
      failure = caught;
    }

    expect(failure).toMatchObject({ _tag: 'GoogleAccessTokenFailure' });
  }

  test(
    'turns text that is not a service account into a failure',
    turnsPieceThatIsNotAServiceAccountIntoAFailure,
  );
  async function turnsATokenRequestWithAnUnusableKeyIntoAFailure() {
    await expect(
      GoogleAccessToken.createAccessToken(SERVICE_ACCOUNT, ['scope']),
    ).rejects.toMatchObject({
      _tag: 'GoogleAccessTokenFailure',
      message: expect.stringContaining('Could not get a Google access token'),
    });
  }

  test(
    'turns a token request with an unusable key into a failure',
    turnsATokenRequestWithAnUnusableKeyIntoAFailure,
  );
}

describe('GoogleAccessToken', describeGoogleAccessToken);
