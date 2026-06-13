/**
 * Secret credential storage — the stable, secret-agnostic API the rest of Launch calls.
 *
 * This is where Launch keeps secret material (the App Store Connect `.p8`, the distribution `.p12`
 * password) so it is encrypted at rest by the OS and never sits in the repo or in `~/.launch`
 * metadata. The actual backend is chosen per host by {@link getSecretStore} — the macOS Keychain on a
 * Mac, the Windows Credential Manager / Linux libsecret elsewhere — so these helpers behave the same
 * on every platform and callers stay unchanged.
 *
 * NOTE: importing a cert into a *codesign* keychain (the `security import` / `security cms` calls in
 * `apple/credentials.ts`) is a different concern and is not secret storage — it stays there.
 */

import { getSecretStore } from "./secretStore.js";

/** Store (or overwrite) a secret for `account` in the host's native secret store. */
export async function setSecret(account: string, value: string): Promise<void> {
  await getSecretStore().set(account, value);
}

/** Read a secret for `account`, or null if it isn't present. */
export async function getSecret(account: string): Promise<string | null> {
  return getSecretStore().get(account);
}

/** Remove a stored secret for `account`. No-op if it doesn't exist. */
export async function deleteSecret(account: string): Promise<void> {
  await getSecretStore().delete(account);
}
