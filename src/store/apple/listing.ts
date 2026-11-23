import type { AppStoreConnect } from '@/apple/app-store-connect.js';

export class AppleListing {
  constructor(private readonly apple: AppStoreConnect) {}

  async list(): Promise<readonly string[]> {
    const apps = await this.apple.listApps();
    const names: string[] = [];

    for (const app of apps.data) {
      const name = app.attributes?.name;

      const isBlank = name == null;

      if (isBlank) {
        continue;
      }

      names.push(name);
    }

    return names;
  }
}
