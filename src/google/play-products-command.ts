// Syncs Google Play in-app products from the Launch product catalog.

import { hasMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import { completeCommand } from '../terminal/command-exit.ts';
import type { InAppPurchaseConfig } from '../types/catalog.ts';
import { loadStoreAppContext } from '../store/shared/select-store-app.ts';
import { loadActiveGoogleStore } from './google-store-command.ts';
import {
  confirmPlayCatalogWrite,
  renderAppliedPlayCatalogAction,
  renderPlayCatalogAction,
} from './play-catalog-command.ts';
import { reconcilePlayProducts, summarizePlayProducts } from './play-products.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import type { Command } from '../cli/command.ts';
import { runCliProgram } from '../cli/run-cli-program.ts';

export type PlayProductsCommandInput = {
  app?: string;
  dryRun: boolean;
  yes: boolean;
};

function productsFailure(operation: string, cause: unknown): never {
  const causeText = typeof cause == 'string' ? cause : '';
  const isBlankCauseText = causeText.length == 0;

  if (isBlankCauseText == false) {
    throw new Error(causeText, { cause });
  }

  const causeHasMessage = hasMessage(cause);

  if (causeHasMessage) {
    throw new Error(cause.message, { cause });
  }

  throw new Error(`${operation} failed.`, { cause });
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

function decodePlayProductsCommandInput(rawCommandInput: unknown): PlayProductsCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Play products command input must be an object.');
  }

  const commandInput: PlayProductsCommandInput = {
    dryRun: readRequiredBoolean(rawCommandInputObject, 'dryRun'),
    yes: readRequiredBoolean(rawCommandInputObject, 'yes'),
  };
  const appName = readExactOptionalString(rawCommandInputObject, 'app');

  if (appName != null) {
    commandInput.app = appName;
  }

  return commandInput;
}

export const PlayProductsCommandInputSchema = decodePlayProductsCommandInput;

function playEnabledProduct(declaredProduct: InAppPurchaseConfig): boolean {
  return declaredProduct.play != null;
}

async function readProductsTarget(appSelector: string | undefined): Promise<{
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
  const productsTarget = await readProductsTarget(commandInput.app);
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
  try {
    var failureCount = await executePlayProducts(rawCommandInput);
  } catch (cause) {
    throw productsFailure('reconcile Play products', cause);
  }

  if (failureCount > 0) {
    completeCommand(1);
  }
}

type PlayProductsOptions = Readonly<{
  app?: string;
  dryRun: boolean;
  yes: boolean;
}>;

/** Attach the `play-products` command to the program. */
export function registerPlayProductsCommand(program: Command): void {
  function runPlayProducts(commandOptions: PlayProductsOptions) {
    let playProductsInput: PlayProductsCommandInput = {
      dryRun: commandOptions.dryRun,
      yes: commandOptions.yes,
    };

    if (commandOptions.app != null) {
      playProductsInput = { ...playProductsInput, app: commandOptions.app };
    }

    const playProductsProgram = playProductsCommandProgram(playProductsInput);

    return runCliProgram(playProductsProgram);
  }

  program
    .command('play-products')
    .description('reconcile Google Play in-app products from the launch.config.ts product catalog')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runPlayProducts);
}
