import { auth as googleAuthentication } from '@googleapis/playdeveloperreporting';
import type { ServiceAccount } from '../types/credentials.ts';
import { serviceAccountJwtOptions } from './play-client.ts';

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
