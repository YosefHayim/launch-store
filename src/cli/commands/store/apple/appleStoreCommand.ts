import type { AppStoreConnectClient } from '../../../../apple/ascClient.ts';
import { loadActiveAscKey } from '../../../../credentials/accounts.ts';
import { errorMessage } from '../../../../services/platform/errorMessage.ts';
import { AppleStoreClientService } from '../../../../services/stores/appleStoreClient.ts';
import type { AscKey } from '../../../../types/credentials.ts';

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
    throw makeActiveAppleStoreFailure({
      message: `Could not load the active Apple account: ${errorMessage(cause)}`,
      cause,
    });
  }

  const loadedAscKey = ascKey;
  const isAccountMissing = loadedAscKey == null;

  if (isAccountMissing) {
    throw makeActiveAppleStoreFailure({
      message: 'No active Apple account. Run `launch creds set-key` first.',
      cause: 'missing-active-account',
    });
  }

  try {
    return AppleStoreClientService.createEffectClient(loadedAscKey);
  } catch (cause) {
    throw makeActiveAppleStoreFailure({
      message: 'Could not create the App Store Connect client.',
      cause,
    });
  }
}
