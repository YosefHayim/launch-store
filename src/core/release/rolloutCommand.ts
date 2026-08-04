import { Data, Effect, Schema } from 'effect';
import { loadConfig } from '../config/config.js';
import { loadActiveAscKey } from '../credentials/accounts.js';
import {
  AppleStoreClientService,
  type AppleStoreClientService as AppleStoreClientRequirements,
} from '../services/appleStoreClient.js';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, type Logger } from '../services/logger.js';
import { notify } from '../services/notify.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import { CommandExitSchema, completeCommand, type CommandExit } from '../terminal/commandExit.js';
import { appRecordMissingMessage, IOS_PLATFORM, pickCurrentVersion } from './appStoreRelease.js';
import { selectIosApps } from './statusCommand.js';

export const RolloutCommandInputSchema = Schema.Struct({
  action: Schema.Literal('pause', 'resume', 'complete'),
  app: Schema.optionalWith(Schema.String, { exact: true }),
});

export type RolloutCommandInput = Schema.Schema.Type<typeof RolloutCommandInputSchema>;
export type RolloutAction = RolloutCommandInput['action'];

export type RolloutCommandFailure = Readonly<{
  readonly _tag: 'RolloutCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeRolloutCommandFailure =
  Data.tagged<RolloutCommandFailure>('RolloutCommandFailure');

export const RolloutCommandFailureSchema: Schema.Schema<RolloutCommandFailure> = Schema.Struct({
  _tag: Schema.Literal('RolloutCommandFailure'),
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
});

type AccountRequirements = Effect.Effect.Context<ReturnType<typeof loadActiveAscKey>>;
type NotifyRequirements = Effect.Effect.Context<ReturnType<typeof notify>>;

type RolloutCommandRequirements =
  | AccountRequirements
  | AppleStoreClientRequirements
  | LaunchPathsService
  | Logger
  | NotifyRequirements;

/** Normalize a rollout dependency failure. */
const rolloutFailure = (
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): RolloutCommandFailure => {
  let message = errorMessage(cause);
  if (explicitMessage !== undefined) message = explicitMessage;
  return makeRolloutCommandFailure({ operation, message, cause });
};

/** Map a public rollout action to App Store Connect's phased-release state. */
export const phasedStateForAction = (action: RolloutAction): 'PAUSE' | 'ACTIVE' | 'COMPLETE' => {
  switch (action) {
    case 'pause':
      return 'PAUSE';
    case 'resume':
      return 'ACTIVE';
    case 'complete':
      return 'COMPLETE';
  }
};

/** Map a public rollout action to the notification contract. */
export const rolloutNotifyStatus = (action: RolloutAction): 'paused' | 'resumed' | 'completed' => {
  switch (action) {
    case 'pause':
      return 'paused';
    case 'resume':
      return 'resumed';
    case 'complete':
      return 'completed';
  }
};

/** Pause, resume, or complete phased release for every selected iOS app. */
export const rolloutCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, CommandExit | RolloutCommandFailure, RolloutCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(RolloutCommandInputSchema)(rawCommandInput);
    const launchPaths = yield* LaunchPaths;
    const logger = yield* createLogger(false);
    const loadedConfiguration = yield* loadConfig(launchPaths.workingDirectory);
    const selectedApps = yield* selectIosApps(loadedConfiguration.apps, commandInput.app);
    if (selectedApps.length === 0) {
      yield* logger.note(
        'No iOS apps discovered. Add an app with an ios.bundleIdentifier in app.json.',
      );
      return;
    }
    const ascKey = yield* loadActiveAscKey();
    if (ascKey === null) {
      return yield* Effect.fail(
        rolloutFailure(
          'load active Apple account',
          'missing-active-account',
          'No active Apple account. Run `launch creds set-key` first.',
        ),
      );
    }
    const appleStoreClients = yield* AppleStoreClientService;
    const appleStore = yield* appleStoreClients.createEffectClient(ascKey);
    const phasedReleaseState = phasedStateForAction(commandInput.action);
    const notificationStatus = rolloutNotifyStatus(commandInput.action);
    let commandFailed = false;
    yield* Effect.forEach(
      selectedApps,
      (selectedApp) =>
        Effect.gen(function* () {
          const appId = yield* appleStore.getAppId(selectedApp.bundleId);
          if (appId === null) {
            yield* logger.error(
              `${selectedApp.name}: ${appRecordMissingMessage(selectedApp.bundleId, 'launch rollout')}`,
            );
            commandFailed = true;
            return;
          }
          const appStoreVersions = yield* appleStore.listAppStoreVersions(appId, IOS_PLATFORM);
          const currentVersion = pickCurrentVersion(appStoreVersions);
          if (currentVersion === null) {
            yield* logger.warn(`${selectedApp.name}: no App Store version to roll out.`);
            return;
          }
          const phasedRelease = yield* appleStore.getPhasedRelease(currentVersion.id);
          if (phasedRelease === null) {
            yield* logger.warn(
              `${selectedApp.name}: version ${currentVersion.versionString} has no phased release; it went out all at once.`,
            );
            commandFailed = true;
            return;
          }
          yield* appleStore.updatePhasedRelease(phasedRelease.id, phasedReleaseState);
          yield* logger.step(
            selectedApp.name,
            `phased release -> ${phasedReleaseState} (was ${phasedRelease.phasedReleaseState})`,
          );
          yield* notify(loadedConfiguration.config, {
            event: 'rollout',
            status: notificationStatus,
            app: selectedApp.name,
            platform: 'ios',
            version: currentVersion.versionString,
            detail: phasedReleaseState,
          });
        }),
      { concurrency: 1, discard: true },
    );
    if (commandFailed) yield* completeCommand(1);
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(CommandExitSchema)(cause)) return cause;
      if (Schema.is(RolloutCommandFailureSchema)(cause)) return cause;
      return rolloutFailure('update phased release', cause);
    }),
  );
