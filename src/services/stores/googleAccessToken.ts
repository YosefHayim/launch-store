import { createServiceAccountAccessToken } from '../../google/serviceAccountToken.ts';
import { readServiceAccount } from '../../google/playClient.ts';
import type { ServiceAccount } from '../../types/credentials.ts';
import { errorMessage } from '../platform/errorMessage.ts';

export type GoogleAccessTokenFailure = Readonly<{
  _tag: 'GoogleAccessTokenFailure';
  message: string;
  cause: unknown;
}>;

function makeGoogleAccessTokenFailure(fields: {
  message: string;
  cause: unknown;
}): GoogleAccessTokenFailure {
  return { _tag: 'GoogleAccessTokenFailure', message: fields.message, cause: fields.cause };
}

type GoogleAccessTokenFixture = Readonly<{
  serviceAccount: ServiceAccount;
  accessToken: string;
}>;

let accessTokenFixture: GoogleAccessTokenFixture | null = null;

export function useGoogleAccessTokenFixture(
  serviceAccount: ServiceAccount,
  accessToken: string,
): void {
  accessTokenFixture = { serviceAccount, accessToken };
}

export function resetGoogleAccessToken(): void {
  accessTokenFixture = null;
}

export const GoogleAccessToken = {
  readServiceAccount(savedServiceAccountKey: string): ServiceAccount {
    if (accessTokenFixture != null) {
      return accessTokenFixture.serviceAccount;
    }

    try {
      return readServiceAccount(savedServiceAccountKey);
    } catch (cause) {
      throw makeGoogleAccessTokenFailure({ message: errorMessage(cause), cause });
    }
  },
  async createAccessToken(account: ServiceAccount, scopes: readonly string[]): Promise<string> {
    if (accessTokenFixture != null) {
      return accessTokenFixture.accessToken;
    }

    try {
      return await createServiceAccountAccessToken(account, scopes);
    } catch (cause) {
      throw makeGoogleAccessTokenFailure({
        message: `Could not get a Google access token: ${errorMessage(cause)}`,
        cause,
      });
    }
  },
};
