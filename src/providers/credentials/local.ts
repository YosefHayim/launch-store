/**
 * The `local` credentials provider — Launch's only credentials backend, serving both platforms.
 *
 * Secret material (the App Store Connect `.p8`, the distribution `.p12` password, the Play
 * service-account JSON, the keystore passwords) lives in the OS secret store; non-secret metadata
 * (key/issuer ids, cert serial, profile paths, keystore path/alias) sits in `~/.launch`. This is the
 * reference implementation of {@link CredentialsProvider}: a future `team`/`s3` backend swaps the
 * storage without the pipeline noticing.
 *
 * `resolve()` is the silent-reuse path: it branches on `ctx.platform` and returns the cached
 * credentials for that platform WITHOUT any network call. Creating missing certificates/profiles
 * (iOS) or the upload keystore (Android) is the job of `launch creds setup` (and the pipeline's inline
 * offer), which run the interactive provisioning flow.
 */

import type {
  AppleCredentials,
  BuildCredentials,
  CredentialsProvider,
  ResolvedBuildContext,
} from "../../core/types.js";
import { getSecret, setSecret } from "../../core/keychain.js";
import { describeStoredCredentials, loadCachedSigningAssets } from "../../apple/credentials.js";
import { describeStoredAndroidCredentials, loadCachedKeystore, loadServiceAccount } from "../../google/credentials.js";

const ACCOUNT_KEY_ID = "asc-key-id";
const ACCOUNT_ISSUER_ID = "asc-issuer-id";
const ACCOUNT_P8 = "asc-p8";

/**
 * Encode the `.p8` PEM for storage as a single line of base64.
 *
 * Why: the PEM is multi-line, and the macOS backend stores secrets via `security … -w`, which
 * HEX-ENCODES any value containing newlines when it's read back (`security … -w` emits hex for
 * non-printable/multi-line data). That silently corrupted the key so every Apple JWT failed with a
 * pkcs8 parse error. Base64 has no newlines, so the value round-trips verbatim on every backend
 * (macOS `security`, Windows Credential Manager, Linux libsecret). The Key ID / Issuer ID are
 * single-line tokens and are stored as-is.
 */
function encodeP8(pem: string): string {
  return Buffer.from(pem, "utf8").toString("base64");
}

/**
 * Decode a stored `.p8` back to its PEM. New imports are base64 (see {@link encodeP8}); a value that
 * doesn't base64-decode to a PEM is returned verbatim, so a key written by an older build (raw PEM)
 * still loads without forcing a re-import.
 */
function decodeP8(stored: string): string {
  const decoded = Buffer.from(stored, "base64").toString("utf8");
  return decoded.includes("PRIVATE KEY") ? decoded : stored;
}

/**
 * Persist an App Store Connect API key into the Keychain. Backs `launch creds set-key`.
 * The `.p8` is the private key's PEM contents (base64-encoded at rest), not its file path.
 */
export async function storeAscKey(keyId: string, issuerId: string, p8: string): Promise<void> {
  await setSecret(ACCOUNT_KEY_ID, keyId);
  await setSecret(ACCOUNT_ISSUER_ID, issuerId);
  await setSecret(ACCOUNT_P8, encodeP8(p8));
}

/** Read just the API key from the Keychain, or null if none is imported. */
export async function loadAscKey(): Promise<AppleCredentials["ascKey"] | null> {
  const [keyId, issuerId, p8] = await Promise.all([
    getSecret(ACCOUNT_KEY_ID),
    getSecret(ACCOUNT_ISSUER_ID),
    getSecret(ACCOUNT_P8),
  ]);
  if (!keyId || !issuerId || !p8) return null;
  return { keyId, issuerId, p8: decodeP8(p8) };
}

/** Error thrown when no iOS API key has been imported yet, with the fix in the message. */
class MissingCredentialsError extends Error {
  constructor() {
    super("No App Store Connect API key found. Import one with: launch creds set-key");
    this.name = "MissingCredentialsError";
  }
}

/** Error thrown when no Play service account has been imported yet, with the fix in the message. */
class MissingAndroidCredentialsError extends Error {
  constructor() {
    super("No Play service account found. Import one with: launch creds set-key --platform android <key.json>");
    this.name = "MissingAndroidCredentialsError";
  }
}

/** Resolve cached iOS credentials: the API key plus any already-provisioned signing assets. */
async function resolveIos(ctx: ResolvedBuildContext): Promise<BuildCredentials> {
  const ascKey = await loadAscKey();
  if (!ascKey) throw new MissingCredentialsError();
  const cached = ctx.app.bundleId ? loadCachedSigningAssets(ctx.app.bundleId) : null;
  return cached ? { platform: "ios", ascKey, signing: cached } : { platform: "ios", ascKey };
}

/** Resolve cached Android credentials: the service-account JSON plus any cached upload keystore. */
async function resolveAndroid(): Promise<BuildCredentials> {
  const serviceAccountJson = await loadServiceAccount();
  if (!serviceAccountJson) throw new MissingAndroidCredentialsError();
  const keystore = await loadCachedKeystore();
  return keystore ? { platform: "android", serviceAccountJson, keystore } : { platform: "android", serviceAccountJson };
}

/** One line of `launch creds status` for the iOS leg. */
async function iosStatus(): Promise<string> {
  const keyId = await getSecret(ACCOUNT_KEY_ID);
  if (!keyId) return "iOS: no API key imported.";
  const { certSerial, bundleIds } = describeStoredCredentials();
  const certLine = certSerial ? `distribution cert ${certSerial}` : "no distribution cert yet";
  const profileLine = bundleIds.length ? `profiles for ${bundleIds.join(", ")}` : "no profiles yet";
  return `iOS: API key ${keyId}; ${certLine}; ${profileLine}.`;
}

/** One line of `launch creds status` for the Android leg. */
async function androidStatus(): Promise<string> {
  const { keystoreAlias, hasServiceAccount } = await describeStoredAndroidCredentials();
  if (!hasServiceAccount && !keystoreAlias) return "Android: no service account or upload keystore yet.";
  const saLine = hasServiceAccount ? "service account present" : "no service account yet";
  const keystoreLine = keystoreAlias ? `upload keystore (alias ${keystoreAlias})` : "no upload keystore yet";
  return `Android: ${saLine}; ${keystoreLine}.`;
}

export const localCredentialsProvider: CredentialsProvider = {
  name: "local",

  resolve(ctx: ResolvedBuildContext): Promise<BuildCredentials> {
    switch (ctx.platform) {
      case "ios":
        return resolveIos(ctx);
      case "android":
        return resolveAndroid();
    }
  },

  async status(): Promise<string> {
    return [await iosStatus(), await androidStatus()].join("\n");
  },
};
