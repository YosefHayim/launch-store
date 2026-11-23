// Opens the Google Play client for the saved service account and confirms a write.

import {
  loadServiceAccount,
  describeMissingPlayServiceAccount,
} from '@/credentials/android-keystore-assets.js';
import { hasMessage } from '@/services/platform/error-message.js';
import { checkTerminalIsInteractive } from '@/services/platform/progress.js';
import { LaunchPrompt } from '@/services/platform/prompt.js';
import { GoogleStoreClientService } from '@/services/stores/google-store-client.js';
import type { GooglePlayClient } from '@/google/play-client.js';
import { makeStoreAppSelectionFailure, selectStoreApp } from '@/store/shared/select-store-app.js';

/** Loading the Play service account or creating its transport client failed. */
type ActiveGoogleStoreFailure = Readonly<{
  readonly _tag: 'ActiveGoogleStoreFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

function makeActiveGoogleStoreFailure(fields: {
  message: string;
  cause: unknown;
}): ActiveGoogleStoreFailure {
  return { _tag: 'ActiveGoogleStoreFailure', ...fields };
}

/** Load the keychain-backed Play service account and create its transport client. */
export async function loadActiveGoogleStore(
  packageName: string,
  appName: string,
): Promise<GooglePlayClient> {
  let serviceAccountJson: string | null = null;

  try {
    serviceAccountJson = await loadServiceAccount(packageName);
  } catch (cause) {
    throw makeActiveGoogleStoreFailure({
      message: 'Could not load the Play service account.',
      cause,
    });
  }

  if (serviceAccountJson == null) {
    let missingMessage = '';

    try {
      missingMessage = await describeMissingPlayServiceAccount(appName);
    } catch (cause) {
      throw makeActiveGoogleStoreFailure({
        message: 'Could not read legacy Play credentials.',
        cause,
      });
    }

    throw makeActiveGoogleStoreFailure({
      message: missingMessage,
      cause: 'missing-service-account',
    });
  }

  try {
    return GoogleStoreClientService.createEffectClient(serviceAccountJson);
  } catch (cause) {
    throw makeActiveGoogleStoreFailure({
      message: 'Could not create the Google Play client.',
      cause,
    });
  }
}

/** Resolve the selected app's Google Play package name. */
export async function resolveGoogleStoreApp(
  appSelector: string | undefined,
): Promise<{ packageName: string; appName: string }> {
  const selectedApp = await selectStoreApp(appSelector);

  if (selectedApp.packageName != null) {
    return { packageName: selectedApp.packageName, appName: selectedApp.name };
  }

  throw makeStoreAppSelectionFailure({
    message: `No Android application id for ${selectedApp.name} (set android.package in app.json).`,
    cause: selectedApp,
  });
}

/** A Google Play command confirmation failed or was unavailable. */
type GoogleStoreConfirmationFailure = Readonly<{
  readonly _tag: 'GoogleStoreConfirmationFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

function makeGoogleStoreConfirmationFailure(fields: {
  message: string;
  cause: unknown;
}): GoogleStoreConfirmationFailure {
  return { _tag: 'GoogleStoreConfirmationFailure', ...fields };
}

function confirmationCauseMessage(cause: unknown): string {
  if (hasMessage(cause)) {
    return cause.message;
  }

  return 'Google Play confirmation failed.';
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
    throw makeGoogleStoreConfirmationFailure({
      message: refusalMessage,
      cause: 'confirmation-required',
    });
  }

  let confirmed = false;

  try {
    confirmed = await LaunchPrompt.confirm(confirmationMessageText);
  } catch (cause) {
    throw makeGoogleStoreConfirmationFailure({
      message: confirmationCauseMessage(cause),
      cause,
    });
  }

  if (confirmed) {
    return true;
  }

  LaunchPrompt.cancel(cancellationMessage);

  return false;
}
