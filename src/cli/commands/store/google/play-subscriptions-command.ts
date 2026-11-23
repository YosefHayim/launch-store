// Syncs Google Play subscription base plans and offers from the Launch catalog.

import { hasMessage } from '@/services/platform/error-message.js';
import { createLogger } from '@/services/platform/logger.js';
import { completeCommand } from '@/terminal/command-exit.js';
import type { SubscriptionConfig } from '@/types/catalog.js';
import { loadStoreAppContext } from '@/store/shared/select-store-app.js';
import { loadActiveGoogleStore } from './google-store-command.ts';
import {
  confirmPlayCatalogWrite,
  renderAppliedPlayCatalogAction,
  renderPlayCatalogAction,
} from './play-catalog-command.ts';
import {
  reconcilePlaySubscriptions,
  summarizePlaySubscriptions,
} from '@/store/google/play-subscriptions.js';
import { readPlainObject } from '@/services/platform/plain-object.js';

export type PlaySubscriptionsCommandInput = {
  app?: string;
  dryRun: boolean;
  yes: boolean;
};

type PlaySubscriptionsCommandFailure = Readonly<{
  readonly _tag: 'PlaySubscriptionsCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function makePlaySubscriptionsCommandFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): PlaySubscriptionsCommandFailure {
  return { _tag: 'PlaySubscriptionsCommandFailure', ...fields };
}

function subscriptionsFailure(operation: string, cause: unknown): PlaySubscriptionsCommandFailure {
  let message = `${operation} failed.`;

  if (typeof cause == 'string') {
    const isBlank = cause.length == 0;

    if (isBlank == false) {
      message = cause;
    }
  }

  if (hasMessage(cause)) {
    message = cause.message;
  }

  return makePlaySubscriptionsCommandFailure({ operation, message, cause });
}

function readRequiredBoolean(record: Record<string, unknown>, fieldName: string): boolean {
  const field = record[fieldName];

  if (typeof field != 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }

  return field;
}

function readExactOptionalString(
  record: Record<string, unknown>,
  fieldName: string,
): string | null {
  if (fieldName in record == false) {
    return null;
  }

  const field = record[fieldName];

  if (typeof field != 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  return field;
}

function decodePlaySubscriptionsCommandInput(
  rawCommandInput: unknown,
): PlaySubscriptionsCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Play subscriptions command input must be an object.');
  }

  const commandInput: PlaySubscriptionsCommandInput = {
    dryRun: readRequiredBoolean(rawCommandInputObject, 'dryRun'),
    yes: readRequiredBoolean(rawCommandInputObject, 'yes'),
  };
  const appName = readExactOptionalString(rawCommandInputObject, 'app');

  if (appName != null) {
    commandInput.app = appName;
  }

  return commandInput;
}

export const PlaySubscriptionsCommandInputSchema = decodePlaySubscriptionsCommandInput;

async function resolveSubscriptionsTarget(appSelector: string | undefined): Promise<{
  appName: string;
  packageName: string;
  subscriptions: SubscriptionConfig[];
}> {
  const storeAppContext = await loadStoreAppContext(appSelector);
  const selectedApp = storeAppContext.app;

  if (selectedApp.packageName == null) {
    throw subscriptionsFailure(
      'resolve Android application id',
      `No Android application id for ${selectedApp.name} (set android.package in app.json).`,
    );
  }

  if (selectedApp.bundleId == null) {
    throw subscriptionsFailure(
      'resolve product catalog',
      `No iOS bundle identifier for ${selectedApp.name} - the product catalog is keyed by bundle id; set ios.bundleIdentifier.`,
    );
  }

  const declaredSubscriptions: SubscriptionConfig[] = [];
  const productCatalog = storeAppContext.config.products;

  if (productCatalog != null) {
    const appCatalog = productCatalog[selectedApp.bundleId];
    const subscriptionGroups = appCatalog?.subscriptionGroups ?? null;

    if (subscriptionGroups != null) {
      for (const subscriptionGroup of subscriptionGroups) {
        for (const subscription of subscriptionGroup.subscriptions) {
          if (subscription.play != null) {
            declaredSubscriptions.push(subscription);
          }
        }
      }
    }
  }

  return {
    appName: selectedApp.name,
    packageName: selectedApp.packageName,
    subscriptions: declaredSubscriptions,
  };
}

function isPlanned(plannedAction: { status: string }): boolean {
  return plannedAction.status == 'planned';
}

function catalogLine(plannedAction: Parameters<typeof renderPlayCatalogAction>[0]): string {
  return renderPlayCatalogAction(plannedAction);
}

function appliedLine(appliedAction: Parameters<typeof renderAppliedPlayCatalogAction>[0]): string {
  return renderAppliedPlayCatalogAction(appliedAction);
}

async function executePlaySubscriptions(rawCommandInput: unknown): Promise<number> {
  const commandInput = decodePlaySubscriptionsCommandInput(rawCommandInput);
  const subscriptionsTarget = await resolveSubscriptionsTarget(commandInput.app);
  const logger = createLogger(false);

  if (subscriptionsTarget.subscriptions.length == 0) {
    logger.gap();
    logger.skip(
      `${subscriptionsTarget.packageName}: no subscriptions carry a play override - nothing to reconcile`,
    );

    return 0;
  }

  const googleStore = await loadActiveGoogleStore(
    subscriptionsTarget.packageName,
    subscriptionsTarget.appName,
  );
  const subscriptionsPlan = await reconcilePlaySubscriptions(googleStore, {
    packageName: subscriptionsTarget.packageName,
    serviceAccountEmail: googleStore.serviceAccountEmail,
    subscriptions: subscriptionsTarget.subscriptions,
    dryRun: true,
  });
  const plannedActions = subscriptionsPlan.actions.filter(isPlanned);

  logger.gap();

  if (subscriptionsPlan.actions.length == 0) {
    logger.ok(`${subscriptionsTarget.packageName}: Play subscriptions already in sync`);
    return 0;
  }

  logger.notice(subscriptionsTarget.packageName, ...subscriptionsPlan.actions.map(catalogLine));
  logger.gap();
  logger.note(`${plannedActions.length} change(s) for ${subscriptionsTarget.packageName}.`);

  if (commandInput.dryRun) {
    logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
    return 0;
  }

  const confirmed = await confirmPlayCatalogWrite(
    `Apply ${plannedActions.length} Play subscription change(s) to ${subscriptionsTarget.packageName}?`,
    commandInput.yes,
  );

  if (confirmed == false) {
    return 0;
  }

  const appliedSubscriptions = await reconcilePlaySubscriptions(googleStore, {
    packageName: subscriptionsTarget.packageName,
    serviceAccountEmail: googleStore.serviceAccountEmail,
    subscriptions: subscriptionsTarget.subscriptions,
    dryRun: false,
  });
  const subscriptionsSummary = summarizePlaySubscriptions(appliedSubscriptions.actions);
  let receiptTitle = 'Applied';

  if (subscriptionsSummary.failed > 0) {
    receiptTitle = 'Applied with errors';
  }

  logger.box(receiptTitle, appliedSubscriptions.actions.map(appliedLine));

  return subscriptionsSummary.failed;
}

/** Run the schema-decoded Play subscriptions command. */
export async function playSubscriptionsCommandProgram(rawCommandInput: unknown): Promise<void> {
  let failureCount = 0;

  try {
    failureCount = await executePlaySubscriptions(rawCommandInput);
  } catch (cause) {
    throw subscriptionsFailure('reconcile Play subscriptions', cause);
  }

  if (failureCount > 0) {
    completeCommand(1);
  }
}
