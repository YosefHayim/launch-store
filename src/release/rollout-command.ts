import { loadConfig } from '../config/config.ts';
import { loadActiveAscKey } from '../credentials/accounts.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import { notify } from '../services/platform/notify.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import {
  AppleStoreClientService,
  appRecordMissingMessage,
} from '../services/stores/apple-store-client.ts';
import { completeCommand, isCommandExit } from '../terminal/command-exit.ts';
import { IOS_PLATFORM, pickCurrentVersion } from './app-store-release.ts';
import { selectIosApps } from './status-command.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

type RolloutAction = 'pause' | 'resume' | 'complete';

type RolloutCommandInput = {
  readonly action: RolloutAction;
  readonly app?: string;
};

type RolloutCommandFailure = Readonly<{
  readonly _tag: 'RolloutCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function makeRolloutCommandFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): RolloutCommandFailure {
  return {
    _tag: 'RolloutCommandFailure',
    operation: fields.operation,
    message: fields.message,
    cause: fields.cause,
  };
}

function isRolloutCommandFailure(cause: unknown): cause is RolloutCommandFailure {
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  if ('_tag' in cause == false) {
    return false;
  }

  return cause._tag == 'RolloutCommandFailure';
}

function rolloutFailure(
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): RolloutCommandFailure {
  let message = errorMessage(cause);

  if (explicitMessage != null) {
    message = explicitMessage;
  }

  return makeRolloutCommandFailure({ operation, message, cause });
}

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
    throw rolloutFailure(
      'decode command input',
      rawCommandInput,
      'Rollout command input must be an object with action pause, resume, or complete.',
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
    throw rolloutFailure(
      'decode command input',
      rawCommandInputObject,
      'Rollout app must be a string.',
    );
  }

  return { action, app: appField };
}

function readRolloutAction(rawCommandInput: Record<string, unknown>): RolloutAction {
  const actionField = rawCommandInput['action'];

  if (isRolloutAction(actionField)) {
    return actionField;
  }

  throw rolloutFailure(
    'decode command input',
    rawCommandInput,
    'Rollout action must be pause, resume, or complete.',
  );
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

/** Map a public rollout action to the notification contract. */
export function rolloutNotifyStatus(action: RolloutAction): 'paused' | 'resumed' | 'completed' {
  switch (action) {
    case 'pause':
      return 'paused';
    case 'resume':
      return 'resumed';
    case 'complete':
      return 'completed';
  }
}

type SelectedIosApp = {
  readonly name: string;
  readonly bundleId: string;
};

async function updateAppRollout(
  appleStore: ReturnType<typeof AppleStoreClientService.createEffectClient>,
  selectedApp: SelectedIosApp,
  phasedReleaseState: 'PAUSE' | 'ACTIVE' | 'COMPLETE',
  notificationStatus: 'paused' | 'resumed' | 'completed',
  loadedConfiguration: Awaited<ReturnType<typeof loadConfig>>,
): Promise<boolean> {
  const logger = createLogger(false);
  const appId = await appleStore.getAppId(selectedApp.bundleId);
  const isAppMissing = appId == null;

  if (isAppMissing) {
    logger.error(
      `${selectedApp.name}: ${appRecordMissingMessage(selectedApp.bundleId, 'launch rollout')}`,
    );
    return true;
  }

  const appStoreVersions = await appleStore.listAppStoreVersions(appId, IOS_PLATFORM);
  const currentVersion = pickCurrentVersion(appStoreVersions);
  const isVersionMissing = currentVersion == null;

  if (isVersionMissing) {
    logger.warn(`${selectedApp.name}: no App Store version to roll out.`);
    return false;
  }

  const phasedRelease = await appleStore.getPhasedRelease(currentVersion.id);
  const isPhasedReleaseMissing = phasedRelease == null;

  if (isPhasedReleaseMissing) {
    logger.warn(
      `${selectedApp.name}: version ${currentVersion.versionString} has no phased release; it went out all at once.`,
    );
    return true;
  }

  await appleStore.updatePhasedRelease(phasedRelease.id, phasedReleaseState);
  logger.step(
    selectedApp.name,
    `phased release -> ${phasedReleaseState} (was ${phasedRelease.phasedReleaseState})`,
  );
  await notify(loadedConfiguration.config, {
    event: 'rollout',
    status: notificationStatus,
    app: selectedApp.name,
    platform: 'ios',
    version: currentVersion.versionString,
    detail: phasedReleaseState,
  });
  return false;
}

/** Pause, resume, or complete phased release for every selected iOS app. */
export async function rolloutCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = decodeRolloutCommandInput(rawCommandInput);
    const launchPaths = readLaunchDirectories();
    const logger = createLogger(false);
    const loadedConfiguration = await loadConfig(launchPaths.workingDirectory);
    const selectedApps = await selectIosApps(loadedConfiguration.apps, commandInput.app);
    const isThereNoIosApp = selectedApps.length == 0;

    if (isThereNoIosApp) {
      logger.note('No iOS apps discovered. Add an app with an ios.bundleIdentifier in app.json.');
      return;
    }

    const ascKey = await loadActiveAscKey();
    const isAccountMissing = ascKey == null;

    if (isAccountMissing) {
      throw rolloutFailure(
        'load active Apple account',
        'missing-active-account',
        'No active Apple account. Run `launch creds set-key` first.',
      );
    }

    const appleStore = AppleStoreClientService.createEffectClient(ascKey);
    const phasedReleaseState = phasedStateForAction(commandInput.action);
    const notificationStatus = rolloutNotifyStatus(commandInput.action);
    let commandFailed = false;

    for (const selectedApp of selectedApps) {
      const appFailed = await updateAppRollout(
        appleStore,
        selectedApp,
        phasedReleaseState,
        notificationStatus,
        loadedConfiguration,
      );

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

    if (isRolloutCommandFailure(cause)) {
      throw cause;
    }

    throw rolloutFailure('update phased release', cause);
  }
}
