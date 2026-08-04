import type { Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchPromptService } from '../services/prompt.js';
import { completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { InAppPurchaseConfig } from '../types/catalog.js';
import { loadActiveGoogleStore, type ActiveGoogleStoreRequirements } from './googleStoreCommand.js';
import {
  confirmPlayCatalogWrite,
  renderAppliedPlayCatalogAction,
  renderPlayCatalogAction,
} from './playCatalogCommand.js';
import { reconcilePlayProducts, summarizePlayProducts } from './playProducts.js';
import { loadStoreAppContext, type StoreAppSelectionRequirements } from './selectStoreApp.js';

export const PlayProductsCommandInputSchema = Schema.Struct({
  app: Schema.optionalWith(Schema.String, { exact: true }),
  dryRun: Schema.Boolean,
  yes: Schema.Boolean,
});

export type PlayProductsCommandInput = Schema.Schema.Type<typeof PlayProductsCommandInputSchema>;

/** A Play products command step failed. */
export type PlayProductsCommandFailure = Readonly<{
  readonly _tag: 'PlayProductsCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makePlayProductsCommandFailure = Data.tagged<PlayProductsCommandFailure>(
  'PlayProductsCommandFailure',
);

type PlayProductsCommandRequirements =
  | ActiveGoogleStoreRequirements
  | LaunchPromptService
  | Logger
  | StoreAppSelectionRequirements
  | Terminal.Terminal;

/** Convert any command dependency failure into the Play products channel. */
const productsFailure = (operation: string, cause: unknown): PlayProductsCommandFailure => {
  let message = `${operation} failed.`;
  if (typeof cause === 'string' && cause.length > 0) message = cause;
  if (cause instanceof Error) message = cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const causeMessage = cause.message;
    if (typeof causeMessage === 'string') message = causeMessage;
  }
  return makePlayProductsCommandFailure({ operation, message, cause });
};

/** Resolve the selected package and its Play-enabled one-time products. */
const resolveProductsTarget = (
  appSelector: string | undefined,
): Effect.Effect<
  Readonly<{ packageName: string; products: InAppPurchaseConfig[] }>,
  PlayProductsCommandFailure,
  StoreAppSelectionRequirements
> =>
  Effect.gen(function* () {
    const storeAppContext = yield* loadStoreAppContext(appSelector).pipe(
      Effect.mapError((cause) => productsFailure('select app', cause)),
    );
    const selectedApp = storeAppContext.app;
    if (selectedApp.packageName === undefined) {
      return yield* Effect.fail(
        productsFailure(
          'resolve Android application id',
          `No Android application id for ${selectedApp.name} (set android.package in app.json).`,
        ),
      );
    }
    if (selectedApp.bundleId === undefined) {
      return yield* Effect.fail(
        productsFailure(
          'resolve product catalog',
          `No iOS bundle identifier for ${selectedApp.name} - the product catalog is keyed by bundle id; set ios.bundleIdentifier.`,
        ),
      );
    }
    let declaredProducts: InAppPurchaseConfig[] = [];
    const productCatalog = storeAppContext.config.products;
    if (productCatalog !== undefined) {
      const appCatalog = productCatalog[selectedApp.bundleId];
      if (appCatalog !== undefined && appCatalog.inAppPurchases !== undefined) {
        declaredProducts = appCatalog.inAppPurchases.filter(
          (declaredProduct) => declaredProduct.play !== undefined,
        );
      }
    }
    return { packageName: selectedApp.packageName, products: declaredProducts };
  });

/** Decode, plan, confirm, and apply Play one-time products. */
const executePlayProducts = (
  rawCommandInput: unknown,
): Effect.Effect<number, PlayProductsCommandFailure, PlayProductsCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(PlayProductsCommandInputSchema)(
      rawCommandInput,
    ).pipe(Effect.mapError((cause) => productsFailure('decode command input', cause)));
    const productsTarget = yield* resolveProductsTarget(commandInput.app);
    const logger = yield* createLogger(false);
    if (productsTarget.products.length === 0) {
      yield* logger.gap();
      yield* logger.skip(
        `${productsTarget.packageName}: no in-app purchases carry a play override - nothing to reconcile`,
      );
      return 0;
    }
    const googleStore = yield* loadActiveGoogleStore();
    const productsPlan = yield* reconcilePlayProducts(googleStore, {
      packageName: productsTarget.packageName,
      products: productsTarget.products,
      dryRun: true,
    });
    const plannedActions = productsPlan.actions.filter(
      (plannedAction) => plannedAction.status === 'planned',
    );
    yield* logger.gap();
    if (productsPlan.actions.length === 0) {
      yield* logger.ok(`${productsTarget.packageName}: Play in-app products already in sync`);
      return 0;
    }
    yield* logger.notice(
      productsTarget.packageName,
      ...productsPlan.actions.map(renderPlayCatalogAction),
    );
    yield* logger.gap();
    yield* logger.note(`${plannedActions.length} change(s) for ${productsTarget.packageName}.`);
    if (commandInput.dryRun) {
      yield* logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
      return 0;
    }
    const confirmed = yield* confirmPlayCatalogWrite(
      `Apply ${plannedActions.length} Play product change(s) to ${productsTarget.packageName}?`,
      commandInput.yes,
    );
    if (!confirmed) return 0;
    const appliedProducts = yield* reconcilePlayProducts(googleStore, {
      packageName: productsTarget.packageName,
      products: productsTarget.products,
      dryRun: false,
    });
    const productsSummary = summarizePlayProducts(appliedProducts.actions);
    let receiptTitle = 'Applied';
    if (productsSummary.failed > 0) receiptTitle = 'Applied with errors';
    yield* logger.box(receiptTitle, appliedProducts.actions.map(renderAppliedPlayCatalogAction));
    return productsSummary.failed;
  }).pipe(Effect.mapError((cause) => productsFailure('reconcile Play products', cause)));

/** Run the schema-decoded Play products command. */
export const playProductsCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, CommandExit | PlayProductsCommandFailure, PlayProductsCommandRequirements> =>
  Effect.gen(function* () {
    const failureCount = yield* executePlayProducts(rawCommandInput);
    if (failureCount > 0) yield* completeCommand(1);
  });
