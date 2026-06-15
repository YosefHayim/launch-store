/**
 * The `local` credentials provider — Launch's only credentials backend, serving both platforms.
 *
 * Secret material (the App Store Connect `.p8`, the distribution `.p12` password, the Play
 * service-account JSON, the keystore passwords) lives in the OS secret store; non-secret metadata
 * (the account registry, cert serial, profile paths, keystore path/alias) sits in `~/.launch`. This is
 * the reference implementation of {@link CredentialsProvider}: a future `team`/`s3` backend swaps the
 * storage without the pipeline noticing.
 *
 * `resolve()` is the silent-reuse path: it branches on `ctx.platform` and returns the cached
 * credentials WITHOUT any network call. For iOS it loads the account named by `ctx.account` (the one
 * the pipeline resolved from `--account`/`ASC_ACCOUNT`/active) — see `core/accounts.ts`. Onboarding a
 * key (`launch creds set-key`) and creating missing certificates/profiles (`launch creds setup`, or
 * the pipeline's inline offer) are separate, interactive flows.
 */

import type { BuildCredentials, CredentialsProvider, ResolvedBuildContext } from "../../core/types.js";
import {
  formatAccountSummary,
  getActiveKeyId,
  listAccounts,
  loadActiveAscKey,
  loadAscKeyById,
} from "../../core/accounts.js";
import { describeStoredCredentials, loadCachedSigningAssets } from "../../apple/credentials.js";
import { describeStoredAndroidCredentials, loadCachedKeystore, loadServiceAccount } from "../../google/credentials.js";

/** Error thrown when no usable iOS account is available, with the fix in the message. */
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

/** Resolve cached iOS credentials: the chosen account's API key plus any already-provisioned signing assets. */
async function resolveIos(ctx: ResolvedBuildContext): Promise<BuildCredentials> {
  const ascKey = ctx.account ? await loadAscKeyById(ctx.account) : await loadActiveAscKey();
  if (!ascKey) throw new MissingCredentialsError();
  const cached = ctx.app.bundleId ? loadCachedSigningAssets(ascKey.keyId, ctx.app.bundleId) : null;
  return cached ? { platform: "ios", ascKey, signing: cached } : { platform: "ios", ascKey };
}

/** Resolve cached Android credentials: the service-account JSON plus any cached upload keystore. */
async function resolveAndroid(): Promise<BuildCredentials> {
  const serviceAccountJson = await loadServiceAccount();
  if (!serviceAccountJson) throw new MissingAndroidCredentialsError();
  const keystore = await loadCachedKeystore();
  return keystore ? { platform: "android", serviceAccountJson, keystore } : { platform: "android", serviceAccountJson };
}

/** The `launch creds status` lines for the iOS leg: one per onboarded account, the active one marked. */
function iosStatus(): string {
  const accounts = listAccounts();
  if (accounts.length === 0) return "iOS: no Apple account imported (add one with `launch creds set-key`).";
  const active = getActiveKeyId();
  const lines = accounts.map((account) => {
    const { certSerial, bundleIds } = describeStoredCredentials(account.keyId);
    const marker = account.keyId === active ? " ← active" : "";
    const cert = certSerial ? `cert ${certSerial}` : "no cert";
    const profiles = bundleIds.length ? `${bundleIds.length} profile(s)` : "no profiles";
    const unresolved = account.teamId || account.apps?.length ? "" : " · unresolved — run `launch creds refresh`";
    return `  • ${account.label}${marker} — ${formatAccountSummary(account, { includeLabel: false })}${unresolved} · ${cert} · ${profiles}`;
  });
  return [`iOS accounts (${accounts.length}):`, ...lines].join("\n");
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
    return [iosStatus(), await androidStatus()].join("\n");
  },
};
