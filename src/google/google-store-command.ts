// Opens the Google Play client for the saved service account and confirms a write.

import {
  loadServiceAccount,
  describeMissingPlayServiceAccount,
} from '../credentials/android-keystore-assets.ts';
import { hasMessage } from '../services/platform/error-message.ts';
import { checkTerminalIsInteractive } from '../services/platform/progress.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import { GoogleStoreClientService } from '../services/stores/google-store-client.ts';
import type { GooglePlayClient } from './play-client.ts';
import { selectStoreApp } from '../store/shared/select-store-app.ts';

/** Load the keychain-backed Play service account and create its transport client. */
export async function loadActiveGoogleStore(
  packageName: string,
  appName: string,
): Promise<GooglePlayClient> {
  try {
    var serviceAccountJson = await loadServiceAccount(packageName);
  } catch (cause) {
    throw new Error('Could not load the Play service account.', { cause });
  }

  if (serviceAccountJson == null) {
    try {
      var missingMessage = await describeMissingPlayServiceAccount(appName);
    } catch (cause) {
      throw new Error('Could not read legacy Play credentials.', { cause });
    }

    throw new Error(missingMessage, { cause: 'missing-service-account' });
  }

  try {
    return new GoogleStoreClientService().createClient(serviceAccountJson);
  } catch (cause) {
    throw new Error('Could not create the Google Play client.', { cause });
  }
}

/** Read the selected app's Google Play package name. */
export async function readGoogleStoreApp(
  appSelector: string | undefined,
): Promise<{ packageName: string; appName: string }> {
  const selectedApp = await selectStoreApp(appSelector);

  if (selectedApp.packageName != null) {
    return { packageName: selectedApp.packageName, appName: selectedApp.name };
  }

  throw new Error(
    `No Android application id for ${selectedApp.name} (set android.package in app.json).`,
    { cause: selectedApp },
  );
}

/** Confirm an outward-facing Google Play write. */
export async function confirmGoogleStoreWrite(
  confirmationMessageText: string,
  assumeYes: boolean,
  refusalMessage: string,
  cancellationMessage: string,
): Promise<boolean> {
  if (assumeYes) {
    return true;
  }

  const terminalIsInteractive = checkTerminalIsInteractive();

  if (terminalIsInteractive == false) {
    throw new Error(refusalMessage, { cause: 'confirmation-required' });
  }

  try {
    var confirmed = await new LaunchPrompt().confirm(confirmationMessageText);
  } catch (cause) {
    const hasCauseMessage = hasMessage(cause);

    if (hasCauseMessage) {
      throw new Error(cause.message, { cause });
    }

    throw new Error('Google Play confirmation failed.', { cause });
  }

  if (confirmed) {
    return true;
  }

  new LaunchPrompt().cancel(cancellationMessage);

  return false;
}
