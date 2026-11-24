// Creates a short-lived token Google Play accepts from a service-account key.

import { createServiceAccountAccessToken } from '../../google/service-account-token.ts';
import { readServiceAccount } from '../../google/play-client.ts';
import type { ServiceAccount } from '../../types/credentials.ts';
import { errorMessage } from '../platform/error-message.ts';

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

export class GoogleAccessToken {
  readServiceAccount(savedServiceAccountKey: string): ServiceAccount {
    if (accessTokenFixture != null) {
      return accessTokenFixture.serviceAccount;
    }

    try {
      return readServiceAccount(savedServiceAccountKey);
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause });
    }
  }

  async createAccessToken(account: ServiceAccount, scopes: readonly string[]): Promise<string> {
    if (accessTokenFixture != null) {
      return accessTokenFixture.accessToken;
    }

    try {
      return await createServiceAccountAccessToken(account, scopes);
    } catch (cause) {
      const failureMessage = errorMessage(cause);

      throw new Error(`Could not get a Google access token: ${failureMessage}`, { cause });
    }
  }
}
