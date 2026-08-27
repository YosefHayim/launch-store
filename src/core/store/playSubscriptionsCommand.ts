import type { Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchPromptService } from '../services/prompt.js';
import { completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { SubscriptionConfig } from '../types/catalog.js';
import { loadActiveGoogleStore, type ActiveGoogleStoreRequirements } from './googleStoreCommand.js';
import {
  confirmPlayCatalogWrite,
  renderAppliedPlayCatalogAction,
  renderPlayCatalogAction,
} from './playCatalogCommand.js';
import { reconcilePlaySubscriptions, summarizePlaySubscriptions } from './playSubscriptions.js';
import { loadStoreAppContext, type StoreAppSelectionRequirements } from './selectStoreApp.js';

export const PlaySubscriptionsCommandInputSchema = Schema.Struct({
  app: Schema.optionalWith(Schema.String, { exact: true }),
  dryRun: Schema.Boolean,
  yes: Schema.Boolean,
});

export type PlaySubscriptionsCommandInput = Schema.Schema.Type<
  typeof PlaySubscriptionsCommandInputSchema
>;

/** A Play subscriptions command step failed. */
export type PlaySubscriptionsCommandFailure = Readonly<{
  readonly _tag: 'PlaySubscriptionsCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makePlaySubscriptionsCommandFailure = Data.tagged<PlaySubscriptionsCommandFailure>(
  'PlaySubscriptionsCommandFailure',
);

type PlaySubscriptionsCommandRequirements =
  | ActiveGoogleStoreRequirements
  | LaunchPromptService
  | Logger
  | StoreAppSelectionRequirements
  | Terminal.Terminal;

/** Convert any command dependency failure into the Play subscriptions channel. */
const subscriptionsFailure = (
  operation: string,
  cause: unknown,
): PlaySubscriptionsCommandFailure => {
  let message = `${operation} failed.`;
  if (typeof cause === 'string' && cause.length > 0) message = cause;
  if (cause instanceof Error) message = cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const causeMessage = cause.message;
    if (typeof causeMessage === 'string') message = causeMessage;
  }
  return makePlaySubscriptionsCommandFailure({ operation, message, cause });
};

/** Resolve the selected package and its Play-enabled subscriptions. */
const resolveSubscriptionsTarget = (
  appSelector: string | undefined,
): Effect.Effect<
  Readonly<{ packageName: string; subscriptions: SubscriptionConfig[] }>,
  PlaySubscriptionsCommandFailure,
  StoreAppSelectionRequirements
> =>
  Effect.gen(function* () {
    const storeAppContext = yield* loadStoreAppContext(appSelector).pipe(
      Effect.mapError((cause) => subscriptionsFailure('select app', cause)),
    );
    const selectedApp = storeAppContext.app;
    if (selectedApp.packageName === undefined) {
      return yield* Effect.fail(
        subscriptionsFailure(
          'resolve Android application id',
          `No Android application id for ${selectedApp.name} (set android.package in app.json).`,
        ),
      );
    }
    if (selectedApp.bundleId === undefined) {
      return yield* Effect.fail(
        subscriptionsFailure(
          'resolve product catalog',
          `No iOS bundle identifier for ${selectedApp.name} - the product catalog is keyed by bundle id; set ios.bundleIdentifier.`,
        ),
      );
    }
    const declaredSubscriptions: SubscriptionConfig[] = [];
    const productCatalog = storeAppContext.config.products;
    if (productCatalog !== undefined) {
      const appCatalog = productCatalog[selectedApp.bundleId];
      if (appCatalog !== undefined && appCatalog.subscriptionGroups !== undefined) {
        for (const subscriptionGroup of appCatalog.subscriptionGroups) {
          for (const subscription of subscriptionGroup.subscriptions) {
            if (subscription.play !== undefined) declaredSubscriptions.push(subscription);
          }
        }
      }
    }
    return {
      packageName: selectedApp.packageName,
      subscriptions: declaredSubscriptions,
    };
  });

/** Decode, plan, confirm, and apply Play subscriptions. */
const executePlaySubscriptions = (
  rawCommandInput: unknown,
): Effect.Effect<number, PlaySubscriptionsCommandFailure, PlaySubscriptionsCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(PlaySubscriptionsCommandInputSchema)(
      rawCommandInput,
    ).pipe(Effect.mapError((cause) => subscriptionsFailure('decode command input', cause)));
    const subscriptionsTarget = yield* resolveSubscriptionsTarget(commandInput.app);
    const logger = yield* createLogger(false);
    if (subscriptionsTarget.subscriptions.length === 0) {
      yield* logger.gap();
      yield* logger.skip(
        `${subscriptionsTarget.packageName}: no subscriptions carry a play override - nothing to reconcile`,
      );
      return 0;
    }
    const googleStore = yield* loadActiveGoogleStore();
    const subscriptionsPlan = yield* reconcilePlaySubscriptions(googleStore, {
      packageName: subscriptionsTarget.packageName,
      serviceAccountEmail: googleStore.serviceAccountEmail,
      subscriptions: subscriptionsTarget.subscriptions,
      dryRun: true,
    });
    const plannedActions = subscriptionsPlan.actions.filter(
      (plannedAction) => plannedAction.status === 'planned',
    );
    yield* logger.gap();
    if (subscriptionsPlan.actions.length === 0) {
      yield* logger.ok(`${subscriptionsTarget.packageName}: Play subscriptions already in sync`);
      return 0;
    }
    yield* logger.notice(
      subscriptionsTarget.packageName,
      ...subscriptionsPlan.actions.map(renderPlayCatalogAction),
    );
    yield* logger.gap();
    yield* logger.note(
      `${plannedActions.length} change(s) for ${subscriptionsTarget.packageName}.`,
    );
    if (commandInput.dryRun) {
      yield* logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
      return 0;
    }
    const confirmed = yield* confirmPlayCatalogWrite(
      `Apply ${plannedActions.length} Play subscription change(s) to ${subscriptionsTarget.packageName}?`,
      commandInput.yes,
    );
    if (!confirmed) return 0;
    const appliedSubscriptions = yield* reconcilePlaySubscriptions(googleStore, {
      packageName: subscriptionsTarget.packageName,
      serviceAccountEmail: googleStore.serviceAccountEmail,
      subscriptions: subscriptionsTarget.subscriptions,
      dryRun: false,
    });
    const subscriptionsSummary = summarizePlaySubscriptions(appliedSubscriptions.actions);
    let receiptTitle = 'Applied';
    if (subscriptionsSummary.failed > 0) receiptTitle = 'Applied with errors';
    yield* logger.box(
      receiptTitle,
      appliedSubscriptions.actions.map(renderAppliedPlayCatalogAction),
    );
    return subscriptionsSummary.failed;
  }).pipe(Effect.mapError((cause) => subscriptionsFailure('reconcile Play subscriptions', cause)));

/** Run the schema-decoded Play subscriptions command. */
export const playSubscriptionsCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<
  void,
  CommandExit | PlaySubscriptionsCommandFailure,
  PlaySubscriptionsCommandRequirements
> =>
  Effect.gen(function* () {
    const failureCount = yield* executePlaySubscriptions(rawCommandInput);
    if (failureCount > 0) yield* completeCommand(1);
  });
