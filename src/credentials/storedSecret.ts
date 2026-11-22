import { LaunchSecretStore } from '../services/credentials/secretStore.ts';

/** Store (or overwrite) a secret for `account` in the host's native secret store. */
export async function setSecret(account: string, secretText: string): Promise<void> {
  await LaunchSecretStore.storeSecret(account, secretText);
}

/** Read a secret for `account`, or null if it isn't present. */
export async function getSecret(account: string): Promise<string | null> {
  return LaunchSecretStore.readSecret(account);
}

/** Remove a stored secret for `account`. No-op if it doesn't exist. */
export async function deleteSecret(account: string): Promise<void> {
  await LaunchSecretStore.deleteSecret(account);
}
