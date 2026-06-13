/**
 * The `local` credentials provider — v1's only credentials backend.
 *
 * Secret material (the App Store Connect `.p8`, the distribution `.p12` password) lives in the
 * macOS Keychain; non-secret metadata (key id, issuer id, cert serial, profile paths) sits in
 * `~/.launch`. This is the reference implementation of {@link CredentialsProvider}: a future
 * `team`/`s3` backend swaps the storage without the pipeline noticing.
 *
 * `resolve()` is the silent-reuse path: it returns the API key plus any already-provisioned signing
 * assets for the app, WITHOUT calling Apple. Creating missing certificates/profiles is the job of
 * `launch creds setup` (and the pipeline's inline offer), which run the interactive provisioning flow.
 */

import type { AppleCredentials, CredentialsProvider, ResolvedBuildContext } from "../../core/types.js";
import { getSecret, setSecret } from "../../core/keychain.js";
import { describeStoredCredentials, loadCachedSigningAssets } from "../../apple/credentials.js";

const ACCOUNT_KEY_ID = "asc-key-id";
const ACCOUNT_ISSUER_ID = "asc-issuer-id";
const ACCOUNT_P8 = "asc-p8";

/**
 * Persist an App Store Connect API key into the Keychain. Backs `launch creds set-key`.
 * The `.p8` is the private key's PEM contents, not its file path.
 */
export async function storeAscKey(keyId: string, issuerId: string, p8: string): Promise<void> {
  await setSecret(ACCOUNT_KEY_ID, keyId);
  await setSecret(ACCOUNT_ISSUER_ID, issuerId);
  await setSecret(ACCOUNT_P8, p8);
}

/** Read just the API key from the Keychain, or null if none is imported. */
export async function loadAscKey(): Promise<AppleCredentials["ascKey"] | null> {
  const [keyId, issuerId, p8] = await Promise.all([
    getSecret(ACCOUNT_KEY_ID),
    getSecret(ACCOUNT_ISSUER_ID),
    getSecret(ACCOUNT_P8),
  ]);
  if (!keyId || !issuerId || !p8) return null;
  return { keyId, issuerId, p8 };
}

/** Error thrown when no API key has been imported yet, with the fix in the message. */
class MissingCredentialsError extends Error {
  constructor() {
    super("No App Store Connect API key found. Import one with: launch creds set-key");
    this.name = "MissingCredentialsError";
  }
}

export const localCredentialsProvider: CredentialsProvider = {
  name: "local",

  async resolve(ctx: ResolvedBuildContext): Promise<AppleCredentials> {
    const ascKey = await loadAscKey();
    if (!ascKey) throw new MissingCredentialsError();
    const cached = ctx.app.bundleId ? loadCachedSigningAssets(ctx.app.bundleId) : null;
    return cached ? { ascKey, signing: cached } : { ascKey };
  },

  async status(): Promise<string> {
    const keyId = await getSecret(ACCOUNT_KEY_ID);
    if (!keyId) return "No API key imported.";
    const { certSerial, bundleIds } = describeStoredCredentials();
    const certLine = certSerial ? `distribution cert ${certSerial}` : "no distribution cert yet";
    const profileLine = bundleIds.length ? `profiles for ${bundleIds.join(", ")}` : "no profiles yet";
    return `API key present (Key ID ${keyId}); ${certLine}; ${profileLine}.`;
  },
};
