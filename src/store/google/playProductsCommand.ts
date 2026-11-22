import { hasMessage } from '../../services/platform/errorMessage.js';
import { createLogger } from '../../services/platform/logger.js';
import { completeCommand } from '../../terminal/commandExit.js';
import type { InAppPurchaseConfig } from '../../types/catalog.js';
import { loadStoreAppContext } from '../shared/selectStoreApp.js';
import { loadActiveGoogleStore } from './googleStoreCommand.js';
import {
  confirmPlayCatalogWrite,
  renderAppliedPlayCatalogAction,
  renderPlayCatalogAction,
} from './playCatalogCommand.js';
import { reconcilePlayProducts, summarizePlayProducts } from './playProducts.js';

export type PlayProductsCommandInput = {
  app?: string;
  dryRun: boolean;
  yes: boolean;
};

type PlayProductsCommandFailure = Readonly<{
  readonly _tag: 'PlayProductsCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function makePlayProductsCommandFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): PlayProductsCommandFailure {
  return { _tag: 'PlayProductsCommandFailure', ...fields };
}

function productsFailure(operation: string, cause: unknown): PlayProductsCommandFailure {
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

  return makePlayProductsCommandFailure({ operation, message, cause });
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  if (Array.isArray(candidate)) {
    return false;
  }

  return true;
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

export function decodePlayProductsCommandInput(rawCommandInput: unknown): PlayProductsCommandInput {
  if (isRecord(rawCommandInput) == false) {
    throw new Error('Play products command input must be an object.');
  }

  const commandInput: PlayProductsCommandInput = {
    dryRun: readRequiredBoolean(rawCommandInput, 'dryRun'),
    yes: readRequiredBoolean(rawCommandInput, 'yes'),
  };
  const appName = readExactOptionalString(rawCommandInput, 'app');

  if (appName != null) {
    commandInput.app = appName;
  }

  return commandInput;
}

export const PlayProductsCommandInputSchema = decodePlayProductsCommandInput;

function playEnabledProduct(declaredProduct: InAppPurchaseConfig): boolean {
  return declaredProduct.play != null;
}

async function resolveProductsTarget(appSelector: string | undefined): Promise<{
  appName: string;
  packageName: string;
  products: InAppPurchaseConfig[];
}> {
  const storeAppContext = await loadStoreAppContext(appSelector);
  const selectedApp = storeAppContext.app;

  if (selectedApp.packageName == null) {
    throw productsFailure(
      'resolve Android application id',
      `No Android application id for ${selectedApp.name} (set android.package in app.json).`,
    );
  }

  if (selectedApp.bundleId == null) {
    throw productsFailure(
      'resolve product catalog',
      `No iOS bundle identifier for ${selectedApp.name} - the product catalog is keyed by bundle id; set ios.bundleIdentifier.`,
    );
  }

  let declaredProducts: InAppPurchaseConfig[] = [];
  const productCatalog = storeAppContext.config.products;

  if (productCatalog != null) {
    const appCatalog = productCatalog[selectedApp.bundleId];

    if (appCatalog?.inAppPurchases != null) {
      declaredProducts = appCatalog.inAppPurchases.filter(playEnabledProduct);
    }
  }

  return {
    appName: selectedApp.name,
    packageName: selectedApp.packageName,
    products: declaredProducts,
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

async function executePlayProducts(rawCommandInput: unknown): Promise<number> {
  const commandInput = decodePlayProductsCommandInput(rawCommandInput);
  const productsTarget = await resolveProductsTarget(commandInput.app);
  const logger = createLogger(false);

  if (productsTarget.products.length == 0) {
    logger.gap();
    logger.skip(
      `${productsTarget.packageName}: no in-app purchases carry a play override - nothing to reconcile`,
    );
    return 0;
  }

  const googleStore = await loadActiveGoogleStore(
    productsTarget.packageName,
    productsTarget.appName,
  );
  const productsPlan = await reconcilePlayProducts(googleStore, {
    packageName: productsTarget.packageName,
    products: productsTarget.products,
    dryRun: true,
  });
  const plannedActions = productsPlan.actions.filter(isPlanned);

  logger.gap();

  if (productsPlan.actions.length == 0) {
    logger.ok(`${productsTarget.packageName}: Play in-app products already in sync`);
    return 0;
  }

  logger.notice(productsTarget.packageName, ...productsPlan.actions.map(catalogLine));
  logger.gap();
  logger.note(`${plannedActions.length} change(s) for ${productsTarget.packageName}.`);

  if (commandInput.dryRun) {
    logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
    return 0;
  }

  const confirmed = await confirmPlayCatalogWrite(
    `Apply ${plannedActions.length} Play product change(s) to ${productsTarget.packageName}?`,
    commandInput.yes,
  );

  if (confirmed == false) {
    return 0;
  }

  const appliedProducts = await reconcilePlayProducts(googleStore, {
    packageName: productsTarget.packageName,
    products: productsTarget.products,
    dryRun: false,
  });
  const productsSummary = summarizePlayProducts(appliedProducts.actions);
  let receiptTitle = 'Applied';

  if (productsSummary.failed > 0) {
    receiptTitle = 'Applied with errors';
  }

  logger.box(receiptTitle, appliedProducts.actions.map(appliedLine));

  return productsSummary.failed;
}

/** Run the schema-decoded Play products command. */
export async function playProductsCommandProgram(rawCommandInput: unknown): Promise<void> {
  let failureCount = 0;

  try {
    failureCount = await executePlayProducts(rawCommandInput);
  } catch (cause) {
    throw productsFailure('reconcile Play products', cause);
  }

  if (failureCount > 0) {
    completeCommand(1);
  }
}
