// Checks an App Store Connect key, then reads the Apple team and app names it can see.

import type { AscKey } from '@/types/credentials.js';
import { AppleStoreClientService } from './apple-store-client.ts';

export type AppStoreIdentity = Readonly<{
  teamId: string | null;
  apps: string[];
}>;

async function readIdentity(ascKey: AscKey): Promise<AppStoreIdentity> {
  const appStoreClient = new AppleStoreClientService().createClient(ascKey);

  async function readTeamId(): Promise<string | null> {
    try {
      return await appStoreClient.resolveTeamId();
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

  const teamId = await readTeamId();
  const apps = await readAppNames();

  return { teamId, apps };
}

export class AppStoreIdentityService {
  async verifyCredentials(ascKey: AscKey): Promise<AppStoreIdentity> {
    const appStoreClient = new AppleStoreClientService().createClient(ascKey);
    await appStoreClient.assertReady();

    return readIdentity(ascKey);
  }

  resolveIdentity(ascKey: AscKey): Promise<AppStoreIdentity> {
    return readIdentity(ascKey);
  }
}
