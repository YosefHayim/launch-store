import { importPKCS8, SignJWT } from 'jose';
import type { AscKey } from '@/types/credentials.js';
import {
  Keychain,
  LEGACY_APPLE_PRIVATE_KEY_ACCOUNT,
  applePrivateKeyAccount,
  findActiveAccount,
  readSavedAccounts,
} from '@/credentials/keychain.js';

export class AppStoreToken {
  constructor(private readonly keychain = new Keychain()) {}

  async sign(): Promise<string> {
    const key = await this.readKey();
    const issuedAt = Math.floor(Date.now() / 1000);
    const tokenLifetimeSeconds = 19 * 60;

    try {
      var privateKey = await importPKCS8(key.p8, 'ES256');
    } catch (error) {
      throw new Error('Could not read the App Store Connect key', { cause: error });
    }

    try {
      var signedToken = await new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: key.keyId, typ: 'JWT' })
        .setIssuer(key.issuerId)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + tokenLifetimeSeconds)
        .setAudience('appstoreconnect-v1')
        .sign(privateKey);
    } catch (error) {
      throw new Error('Could not sign the App Store Connect token', { cause: error });
    }

    return signedToken;
  }

  private async readKey(): Promise<AscKey> {
    const saved = await readSavedAccounts();
    const isMissing = saved == null;

    if (isMissing) {
      throw new Error('No App Store Connect account is saved. Run launch creds.');
    }

    const account = findActiveAccount(saved);
    const namedKey = await this.keychain.read(applePrivateKeyAccount(account.keyId));
    const hasNamedKey = namedKey != null;

    if (hasNamedKey) {
      return { keyId: account.keyId, issuerId: account.issuerId, p8: namedKey };
    }

    const legacyKey = await this.keychain.read(LEGACY_APPLE_PRIVATE_KEY_ACCOUNT);
    const isLegacyMissing = legacyKey == null;

    if (isLegacyMissing) {
      throw new Error('The App Store Connect key is not in the keychain');
    }

    return { keyId: account.keyId, issuerId: account.issuerId, p8: legacyKey };
  }
}
