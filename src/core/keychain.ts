/**
 * macOS Keychain access via the built-in `security` CLI.
 *
 * This is where Launch keeps secret credential material (the App Store Connect `.p8`, and later the
 * `.p12` password) so it is encrypted at rest by the OS and never sits in the repo or in `~/.launch`
 * metadata. Generic, secret-agnostic helpers; the credentials provider decides the account names.
 *
 * Note: `security ... -w <value>` passes the secret as an argument, briefly visible to `ps`. This
 * matches how Xcode/fastlane tooling behaves and is an accepted tradeoff for a local developer tool.
 */

import { capture } from "./exec.js";

/** Keychain service all Launch secrets are filed under, so they're easy to find/audit/remove. */
const SERVICE = "launch";

/** Store (or overwrite, via `-U`) a secret for `account` in the login keychain. */
export async function setSecret(account: string, value: string): Promise<void> {
  await capture("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w", value]);
}

/** Read a secret for `account`, or null if it isn't present. */
export async function getSecret(account: string): Promise<string | null> {
  try {
    return await capture("security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"]);
  } catch {
    return null;
  }
}

/** Remove a stored secret for `account`. No-op if it doesn't exist. */
export async function deleteSecret(account: string): Promise<void> {
  try {
    await capture("security", ["delete-generic-password", "-s", SERVICE, "-a", account]);
  } catch {
    /* already absent */
  }
}
