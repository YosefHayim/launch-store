import { Effect } from 'effect';
import { LaunchSecretStore, type LaunchSecretStoreService } from '../services/secretStore.js';
/** Store (or overwrite) a secret for `account` in the host's native secret store. */
export const setSecret = (
  account: string,
  secretText: string,
): Effect.Effect<void, unknown, LaunchSecretStoreService> => {
  return LaunchSecretStore.pipe(
    Effect.flatMap((secretStore) => secretStore.storeSecret(account, secretText)),
  );
};
/** Read a secret for `account`, or null if it isn't present. */
export const getSecret = (
  account: string,
): Effect.Effect<string | null, unknown, LaunchSecretStoreService> => {
  return LaunchSecretStore.pipe(Effect.flatMap((secretStore) => secretStore.readSecret(account)));
};
/** Remove a stored secret for `account`. No-op if it doesn't exist. */
export const deleteSecret = (
  account: string,
): Effect.Effect<void, unknown, LaunchSecretStoreService> => {
  return LaunchSecretStore.pipe(Effect.flatMap((secretStore) => secretStore.deleteSecret(account)));
};
