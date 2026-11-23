// Opens an App Store Connect client for the active saved account.

import type { AppStoreConnectClient } from '@/apple/app-store-connect-client.js';
import { loadActiveAscKey } from '@/credentials/accounts.js';
import { errorMessage } from '@/services/platform/error-message.js';
import { AppleStoreClientService } from '@/services/stores/apple-store-client.js';
import type { AscKey } from '@/types/credentials.js';

/** Loading the active Apple account or creating its transport client failed. */
type ActiveAppleStoreFailure = Readonly<{
  readonly _tag: 'ActiveAppleStoreFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

function makeActiveAppleStoreFailure(fields: {
  message: string;
  cause: unknown;
}): ActiveAppleStoreFailure {
  return { _tag: 'ActiveAppleStoreFailure', message: fields.message, cause: fields.cause };
}

/** Load the active keychain-backed Apple account and create its transport client. */
export async function loadActiveAppleStore(): Promise<AppStoreConnectClient> {
  let ascKey: AscKey | null = null;

  try {
    ascKey = await loadActiveAscKey();
  } catch (cause) {
    const failureMessage = errorMessage(cause);

    throw makeActiveAppleStoreFailure({
      message: `Could not load the active Apple account: ${failureMessage}`,
      cause,
    });
  }

  const loadedAscKey = ascKey;

  const isAccountMissing = loadedAscKey == null;

  if (isAccountMissing) {
    throw makeActiveAppleStoreFailure({
      message: 'No active Apple account. Run `launch-store creds set-key` first.',
      cause: 'missing-active-account',
    });
  }

  try {
    return new AppleStoreClientService().createClient(loadedAscKey);
  } catch (cause) {
    throw makeActiveAppleStoreFailure({
      message: 'Could not create the App Store Connect client.',
      cause,
    });
  }
}
