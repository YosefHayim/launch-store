// Reads the Google Play service-account file saved for one Android package.

import { Keychain, LEGACY_PLAY_SERVICE_ACCOUNT, playServiceAccount } from './keychain.ts';

export class AndroidKeystore {
  constructor(private readonly keychain = new Keychain()) {}

  async read(packageName: string): Promise<string> {
    const named = await this.keychain.read(playServiceAccount(packageName));

    const hasNamed = named != null;

    if (hasNamed) {
      return decodeServiceAccount(named);
    }

    const legacy = await this.keychain.read(LEGACY_PLAY_SERVICE_ACCOUNT);

    const isMissing = legacy == null;

    if (isMissing) {
      throw new Error(`No Play service account is saved for ${packageName}`);
    }

    return decodeServiceAccount(legacy);
  }
}

function decodeServiceAccount(stored: string): string {
  return Buffer.from(stored, 'base64').toString('utf8');
}
