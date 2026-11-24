// Pauses, resumes, or completes an App Store Connect phased release.

import { loadConfig } from '../config/config.ts';
import { loadActiveAscKey } from '../credentials/accounts.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import {
  AppleStoreClientService,
  appRecordMissingMessage,
} from '../services/stores/apple-store-client.ts';
import { completeCommand, isCommandExit } from '../terminal/command-exit.ts';
import { IOS_PLATFORM, pickCurrentVersion } from './app-store-release.ts';
import { selectIosApps } from './status-command.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import { redactText } from '../services/platform/redact.ts';

type RolloutAction = 'pause' | 'resume' | 'complete';

type RolloutCommandInput = {
  readonly action: RolloutAction;
  readonly app?: string;
};

function isRolloutAction(action: unknown): action is RolloutAction {
  if (action == 'pause') {
    return true;
  }

  if (action == 'resume') {
    return true;
  }

  if (action == 'complete') {
    return true;
  }

  return false;
}

export function decodeRolloutCommandInput(rawCommandInput: unknown): RolloutCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error(
      'Rollout command input must be an object with action pause, resume, or complete.',
      { cause: rawCommandInput },
    );
  }

  const action = readRolloutAction(rawCommandInputObject);
  const appField = rawCommandInputObject['app'];

  const isAppAbsent = appField == null;

  if (isAppAbsent) {
    return { action };
  }

  const isAppText = typeof appField == 'string';

  if (isAppText == false) {
    throw new Error('Rollout app must be a string.', { cause: rawCommandInputObject });
  }

  return { action, app: appField };
}

function readRolloutAction(rawCommandInput: Record<string, unknown>): RolloutAction {
  const actionField = rawCommandInput['action'];

  if (isRolloutAction(actionField)) {
    return actionField;
  }

  throw new Error('Rollout action must be pause, resume, or complete.', {
    cause: rawCommandInput,
  });
}

/** Map a public rollout action to App Store Connect's phased-release state. */
export function phasedStateForAction(action: RolloutAction): 'PAUSE' | 'ACTIVE' | 'COMPLETE' {
  switch (action) {
    case 'pause':
      return 'PAUSE';
    case 'resume':
      return 'ACTIVE';
    case 'complete':
      return 'COMPLETE';
  }
}

type SelectedIosApp = {
  readonly name: string;
  readonly bundleId: string;
};

async function updateAppRollout(
  appleStore: ReturnType<AppleStoreClientService['createClient']>,
  selectedApp: SelectedIosApp,
  phasedReleaseState: 'PAUSE' | 'ACTIVE' | 'COMPLETE',
): Promise<boolean> {
  const appId = await appleStore.getAppId(selectedApp.bundleId);

  const isAppMissing = appId == null;

  if (isAppMissing) {
    const appMissingMessage = appRecordMissingMessage(selectedApp.bundleId, 'launch-store rollout');
    console.log(redactText(`${selectedApp.name}: ${appMissingMessage}`));
    return true;
  }

  const appStoreVersions = await appleStore.listAppStoreVersions(appId, IOS_PLATFORM);
  const currentVersion = pickCurrentVersion(appStoreVersions);

  const isVersionMissing = currentVersion == null;

  if (isVersionMissing) {
    console.log(redactText(`${selectedApp.name}: no App Store version to roll out.`));
    return false;
  }

  const phasedRelease = await appleStore.getPhasedRelease(currentVersion.id);

  const isPhasedReleaseMissing = phasedRelease == null;

  if (isPhasedReleaseMissing) {
    console.log(
      redactText(
        `${selectedApp.name}: version ${currentVersion.versionString} has no phased release; it went out all at once.`,
      ),
    );
    return true;
  }

  await appleStore.updatePhasedRelease(phasedRelease.id, phasedReleaseState);
  console.log(
    redactText(
      `${selectedApp.name} - phased release -> ${phasedReleaseState} (was ${phasedRelease.phasedReleaseState})`,
    ),
  );

  return false;
}

/** Pause, resume, or complete phased release for every selected iOS app. */
export async function rolloutCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = decodeRolloutCommandInput(rawCommandInput);
    const launchPaths = readLaunchDirectories();
    const loadedConfiguration = await loadConfig(launchPaths.workingDirectory);
    const selectedApps = await selectIosApps(loadedConfiguration.apps, commandInput.app);

    const isThereNoIosApp = selectedApps.length == 0;

    if (isThereNoIosApp) {
      console.log(
        redactText('No iOS apps discovered. Add an app with an ios.bundleIdentifier in app.json.'),
      );
      return;
    }

    const ascKey = await loadActiveAscKey();

    const isAccountMissing = ascKey == null;

    if (isAccountMissing) {
      throw new Error('No active Apple account. Run `launch-store creds set-key` first.', {
        cause: 'missing-active-account',
      });
    }

    const appleStore = new AppleStoreClientService().createClient(ascKey);
    const phasedReleaseState = phasedStateForAction(commandInput.action);
    let commandFailed = false;

    for (const selectedApp of selectedApps) {
      const appFailed = await updateAppRollout(appleStore, selectedApp, phasedReleaseState);

      if (appFailed) {
        commandFailed = true;
      }
    }

    if (commandFailed) {
      completeCommand(1);
    }
  } catch (cause) {
    if (isCommandExit(cause)) {
      throw cause;
    }

    const isAlreadyError = cause instanceof Error;

    if (isAlreadyError) {
      throw cause;
    }

    const failureMessage = errorMessage(cause);

    throw new Error(failureMessage, { cause });
  }
}
