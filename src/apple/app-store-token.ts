import { createPrivateKey, sign } from 'node:crypto';
import type { AscKey } from '../types/credentials.ts';
import {
  Keychain,
  LEGACY_APPLE_PRIVATE_KEY_ACCOUNT,
  applePrivateKeyAccount,
  findActiveAccount,
  readSavedAccounts,
} from '../credentials/keychain.ts';

export class AppStoreToken {
  constructor(private readonly keychain = new Keychain()) {}

  async sign(): Promise<string> {
    const key = await this.readKey();
    const issuedAt = Math.floor(Date.now() / 1000);

    return signAppStoreConnectToken(key, issuedAt);
  }

  private async readKey(): Promise<AscKey> {
    const saved = await readSavedAccounts();

    const isMissing = saved == null;

    if (isMissing) {
      throw new Error('No App Store Connect account is saved. Run launch-store creds.');
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

export function signAppStoreConnectToken(key: AscKey, issuedAt: number): string {
  const tokenLifetimeSeconds = 19 * 60;

  try {
    var privateKey = createPrivateKey(key.p8);
  } catch (error) {
    throw new Error('Could not read the App Store Connect key', { cause: error });
  }

  const serialized = JSON.stringify({ alg: 'ES256', kid: key.keyId, typ: 'JWT' });
  const headerSegment = base64Url(serialized);
  const claimSegment = base64Url(
    JSON.stringify({
      iss: key.issuerId,
      iat: issuedAt,
      exp: issuedAt + tokenLifetimeSeconds,
      aud: 'appstoreconnect-v1',
    }),
  );
  const signingInput = `${headerSegment}.${claimSegment}`;

  try {
    const bufferBytes = Buffer.from(signingInput);
    var signature = sign('sha256', bufferBytes, {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    });
  } catch (error) {
    throw new Error('Could not sign the App Store Connect token', { cause: error });
  }

  return `${signingInput}.${base64Url(signature)}`;
}

function base64Url(bytes: string | Buffer): string {
  const encoded = Buffer.from(bytes).toString('base64url');

  return encoded;
}
