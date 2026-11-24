// Opens an App Store Connect client for the active saved account.

import type { AppStoreConnect } from './app-store-connect.ts';
import { loadActiveAscKey } from '../credentials/accounts.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { AppleStoreClientService } from '../services/stores/apple-store-client.ts';

/** Load the active keychain-backed Apple account and create its transport client. */
export async function loadActiveAppleStore(): Promise<AppStoreConnect> {
  try {
    var ascKey = await loadActiveAscKey();
  } catch (cause) {
    const failureMessage = errorMessage(cause);

    throw new Error(`Could not load the active Apple account: ${failureMessage}`, { cause });
  }

  if (ascKey == null) {
    throw new Error('No active Apple account. Run `launch-store creds set-key` first.', {
      cause: 'missing-active-account',
    });
  }

  try {
    return new AppleStoreClientService().createClient(ascKey);
  } catch (cause) {
    throw new Error('Could not create the App Store Connect client.', { cause });
  }
}
