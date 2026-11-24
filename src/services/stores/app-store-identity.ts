// Checks an App Store Connect key, then reads the Apple team and app names it can see.

import type { AscKey } from '../../types/credentials.ts';
import { AppleStoreClientService } from './apple-store-client.ts';

export type AppStoreIdentity = Readonly<{
  teamId: string | null;
  apps: string[];
}>;

async function fetchIdentity(ascKey: AscKey): Promise<AppStoreIdentity> {
  const appStoreClient = new AppleStoreClientService().createClient(ascKey);

  async function teamIdOrNull(): Promise<string | null> {
    try {
      return await appStoreClient.readTeamId();
    } catch (error) {
      const isMissing = error != null;

      if (isMissing) {
        return null;
      }

      throw error;
    }
  }

  async function readAppNames(): Promise<string[]> {
    try {
      return await appStoreClient.listAppNames();
    } catch (error) {
      const isMissing = error != null;

      if (isMissing) {
        return [];
      }

      throw error;
    }
  }

  const teamId = await teamIdOrNull();
  const apps = await readAppNames();

  return { teamId, apps };
}

export class AppStoreIdentityService {
  async verifyCredentials(ascKey: AscKey): Promise<AppStoreIdentity> {
    const appStoreClient = new AppleStoreClientService().createClient(ascKey);
    await appStoreClient.assertReady();

    return fetchIdentity(ascKey);
  }

  readIdentity(ascKey: AscKey): Promise<AppStoreIdentity> {
    return fetchIdentity(ascKey);
  }
}
