import { auth as googleAuthentication } from '@googleapis/playdeveloperreporting';
import type { ServiceAccount } from '../types/credentials.ts';
import { serviceAccountJwtOptions } from './play-client.ts';

export async function createServiceAccountAccessToken(
  account: ServiceAccount,
  scopes: readonly string[],
): Promise<string> {
  const serviceAccountJwt = serviceAccountJwtOptions(account, scopes);
  const jwtClient = new googleAuthentication.JWT(serviceAccountJwt);
  const tokenReply = await jwtClient.getAccessToken();
  const accessToken = tokenReply.token;

  if (typeof accessToken != 'string') {
    throw new Error('Google returned no access token for the service account.');
  }

  if (accessToken.length == 0) {
    throw new Error('Google returned an empty access token for the service account.');
  }

  return accessToken;
}
