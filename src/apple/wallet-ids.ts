// Reconciles Apple Pay merchant ids and Wallet pass type ids on App Store Connect.

import type { MerchantIdResource, PassTypeIdResource } from '../types/apple-catalog.ts';
import { plan, type ReconcileContext } from '../store/shared/reconcile.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import type { PlannedAction } from '../types/reconcile.ts';
import type { WalletConfig, WalletIdConfig } from '../types/store-surface.ts';
import { decodeStoreSurfaceConfig } from '../store/shared/surface-config.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

const WALLET_DOCUMENT_NAME = 'launch.config.ts wallet';

function readRequiredText(record: Record<string, unknown>, fieldName: string): string {
  const field = record[fieldName];
  const isText = typeof field == 'string';

  if (isText == false) {
    throw new Error(`${WALLET_DOCUMENT_NAME}: ${fieldName} must be a non-empty string.`);
  }

  const isEmpty = field.length == 0;

  if (isEmpty) {
    throw new Error(`${WALLET_DOCUMENT_NAME}: ${fieldName} must be a non-empty string.`);
  }

  return field;
}

function readWalletIdentifier(entry: unknown): WalletIdConfig {
  const entryObject = readPlainObject(entry);

  if (entryObject == null) {
    throw new Error(`${WALLET_DOCUMENT_NAME}: identifier entries must be JSON objects.`);
  }

  return {
    identifier: readRequiredText(entryObject, 'identifier'),
    name: readRequiredText(entryObject, 'name'),
  };
}

function readWalletFamily(
  documentRecord: Record<string, unknown>,
  familyName: 'merchantIds' | 'passTypeIds',
): readonly WalletIdConfig[] | null {
  const hasFamily = Object.hasOwn(documentRecord, familyName);

  if (hasFamily == false) {
    return null;
  }

  const family = documentRecord[familyName];
  const isFamilyList = Array.isArray(family);

  if (isFamilyList == false) {
    throw new Error(`Expected ${familyName} to be an array.`);
  }

  const identifiers: WalletIdConfig[] = [];

  for (const entry of family) {
    const walletIdentifier = readWalletIdentifier(entry);
    identifiers.push(walletIdentifier);
  }

  return identifiers;
}

function familyCount(family: readonly WalletIdConfig[] | null): number {
  if (family == null) {
    return 0;
  }

  return family.length;
}

function decodeWalletDocument(rawDocument: unknown): WalletConfig {
  const documentRecord = rawDocument as Record<string, unknown>;
  const merchantIds = readWalletFamily(documentRecord, 'merchantIds');
  const passTypeIds = readWalletFamily(documentRecord, 'passTypeIds');
  const declaredCount = familyCount(merchantIds) + familyCount(passTypeIds);
  const hasDeclaration = declaredCount > 0;

  if (hasDeclaration == false) {
    throw new Error(
      'launch.config.ts wallet must declare at least one entry under "merchantIds" or "passTypeIds".',
    );
  }

  const walletConfig: {
    merchantIds?: readonly WalletIdConfig[];
    passTypeIds?: readonly WalletIdConfig[];
  } = {};

  const hasMerchantIds = merchantIds != null;

  if (hasMerchantIds) {
    walletConfig.merchantIds = merchantIds;
  }

  const hasPassTypeIds = passTypeIds != null;

  if (hasPassTypeIds) {
    walletConfig.passTypeIds = passTypeIds;
  }

  return walletConfig;
}

const walletConfigSpec = {
  documentName: WALLET_DOCUMENT_NAME,
  displayName: 'wallet config',
  decodeDocument: decodeWalletDocument,
};

/** The exact slice of App Store Connect the wallet reconciler depends on. */
export type AscWalletApi = {
  listMerchantIds(): Promise<MerchantIdResource[]>;

  createMerchantId(identifier: string, name: string): Promise<void>;

  listPassTypeIds(): Promise<PassTypeIdResource[]>;

  createPassTypeId(identifier: string, name: string): Promise<void>;
};

function hasDeclaredFamily(
  family: readonly WalletIdConfig[] | undefined,
): family is readonly WalletIdConfig[] {
  if (family == null) {
    return false;
  }

  return family.length > 0;
}

/** Create each declared identifier of one family that Apple doesn't already have (matched on `identifier`). */
async function reconcileFamily(
  reconcileContext: ReconcileContext,
  label: string,
  existing: Set<string>,
  declared: readonly WalletIdConfig[],
  create: (identifier: string, name: string) => Promise<void>,
): Promise<void> {
  for (const declaredIdentifier of declared) {
    const alreadyRegistered = existing.has(declaredIdentifier.identifier);

    if (alreadyRegistered) {
      continue;
    }

    const action = plan(
      reconcileContext,
      `register ${label} ${declaredIdentifier.identifier} (${declaredIdentifier.name})`,
    );

    const isDryRun = reconcileContext.dryRun == true;

    if (isDryRun) {
      continue;
    }

    try {
      await create(declaredIdentifier.identifier, declaredIdentifier.name);
      action.status = 'applied';
    } catch (writeFailure) {
      action.status = 'failed';
      action.error = errorMessage(writeFailure);
    }
  }
}

/** Collect the identifiers present on a list of registered ids, for additive matching. */
function identifiersOf(entries: { identifier?: string }[]): Set<string> {
  const identifiers = new Set<string>();

  for (const entry of entries) {
    const identifier = entry.identifier;
    const hasIdentifier = identifier != null;

    if (hasIdentifier == false) {
      continue;
    }

    const isEmpty = identifier.length == 0;

    if (isEmpty) {
      continue;
    }

    identifiers.add(identifier);
  }

  return identifiers;
}

/** Reconcile the team's Apple Pay merchant ids and Wallet pass type ids. */
export async function reconcileWalletIds(
  api: AscWalletApi,
  config: WalletConfig,
  dryRun: boolean,
): Promise<PlannedAction[]> {
  const reconcileContext: ReconcileContext = { actions: [], dryRun };

  const shouldReconcileMerchants = hasDeclaredFamily(config.merchantIds);

  if (shouldReconcileMerchants) {
    const merchantIds = await api.listMerchantIds();
    const existing = identifiersOf(merchantIds);

    await reconcileFamily(
      reconcileContext,
      'Apple Pay merchant id',
      existing,
      config.merchantIds,
      function createMerchant(identifier: string, name: string) {
        return api.createMerchantId(identifier, name);
      },
    );
  }

  const shouldReconcilePasses = hasDeclaredFamily(config.passTypeIds);

  if (shouldReconcilePasses) {
    const passTypeIds = await api.listPassTypeIds();
    const existing = identifiersOf(passTypeIds);

    await reconcileFamily(
      reconcileContext,
      'Wallet pass type id',
      existing,
      config.passTypeIds,
      function createPassType(identifier: string, name: string) {
        return api.createPassTypeId(identifier, name);
      },
    );
  }

  return reconcileContext.actions;
}

/** Decode a wallet section from launch.config.ts. */
export function parseWalletConfig(rawDocument: unknown): WalletConfig {
  return decodeStoreSurfaceConfig(rawDocument, walletConfigSpec);
}
