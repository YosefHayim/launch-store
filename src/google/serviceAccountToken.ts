import { auth as googleAuthentication } from '@googleapis/playdeveloperreporting';
import type { ServiceAccount } from '../core/types/credentials.js';
import { serviceAccountJwtOptions } from './playClient.js';

/** Mint a short-lived OAuth access token for one service account and its scopes. */
export const createServiceAccountAccessToken = async (
  account: ServiceAccount,
  scopes: readonly string[],
): Promise<string> => {
  const jwtClient = new googleAuthentication.JWT(serviceAccountJwtOptions(account, scopes));
  const tokenReply = await jwtClient.getAccessToken();
  const accessToken = tokenReply.token;
  if (typeof accessToken !== 'string') {
    throw new Error('Google returned no access token for the service account.');
  }
  if (accessToken.length === 0) {
    throw new Error('Google returned an empty access token for the service account.');
  }
  return accessToken;
};
