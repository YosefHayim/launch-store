import type { AscKey } from '../../types/credentials.ts';
import { AppleStoreClientService } from './apple-store-client.ts';

export type AppStoreIdentity = Readonly<{
  teamId: string | null;
  apps: string[];
}>;

async function readIdentity(ascKey: AscKey): Promise<AppStoreIdentity> {
  const appStoreClient = AppleStoreClientService.createEffectClient(ascKey);

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

export type AppStoreIdentityService = {
  verifyCredentials(ascKey: AscKey): Promise<AppStoreIdentity>;
  resolveIdentity(ascKey: AscKey): Promise<AppStoreIdentity>;
};

export const AppStoreIdentityService = {
  async verifyCredentials(ascKey: AscKey): Promise<AppStoreIdentity> {
    const appStoreClient = AppleStoreClientService.createEffectClient(ascKey);
    await appStoreClient.assertReady();

    return readIdentity(ascKey);
  },
  resolveIdentity(ascKey: AscKey): Promise<AppStoreIdentity> {
    return readIdentity(ascKey);
  },
};
