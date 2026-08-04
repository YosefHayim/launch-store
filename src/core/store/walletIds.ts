import { Effect, Schema } from 'effect';
import type { MerchantIdResource, PassTypeIdResource } from '../types/appleCatalog.js';
import { plan, type ReconcileContext } from './reconcile.js';
import { errorMessage } from '../services/errorMessage.js';
import type { PlannedAction } from '../types/reconcile.js';
import type { WalletConfig, WalletIdConfig } from '../types/storeSurface.js';
import {
  decodeStoreSurfaceConfig,
  loadStoreSurfaceConfig,
  type StoreSurfaceConfigFailure,
} from './surfaceConfig.js';

const WalletIdentifierSchema = Schema.mutable(
  Schema.Struct({
    identifier: Schema.String.pipe(
      Schema.nonEmptyString({
        message: () => 'wallet.config.json: identifier must be a non-empty string.',
      }),
    ),
    name: Schema.String.pipe(
      Schema.nonEmptyString({
        message: () => 'wallet.config.json: name must be a non-empty string.',
      }),
    ),
  }),
);

export const WalletConfigSchema = Schema.mutable(
  Schema.Struct({
    merchantIds: Schema.optionalWith(Schema.mutable(Schema.Array(WalletIdentifierSchema)), {
      exact: true,
    }),
    passTypeIds: Schema.optionalWith(Schema.mutable(Schema.Array(WalletIdentifierSchema)), {
      exact: true,
    }),
  }),
).pipe(
  Schema.filter((walletConfig) => {
    let merchantIdCount = 0;
    if (walletConfig.merchantIds !== undefined) merchantIdCount = walletConfig.merchantIds.length;
    let passTypeIdCount = 0;
    if (walletConfig.passTypeIds !== undefined) passTypeIdCount = walletConfig.passTypeIds.length;
    if (merchantIdCount + passTypeIdCount > 0) return true;
    return 'wallet.config.json must declare at least one entry under "merchantIds" or "passTypeIds".';
  }),
);

const WalletConfigSpec = {
  documentName: 'wallet.config.json',
  displayName: 'wallet config',
  missingMessage: (configPath: string) =>
    `No wallet config at ${configPath}. Create one (see \`launch wallet --help\`) or pass --config.`,
  schema: WalletConfigSchema,
};
/**
 * The exact slice of {@link AppStoreConnectClient} the wallet reconciler depends on. Declaring it here
 * (rather than taking the concrete client) keeps the diff logic unit-testable with a hand-rolled fake;
 * `AppStoreConnectClient` satisfies it structurally, mirroring {@link AscEuDistributionApi}.
 */
export type AscWalletApi = {
  listMerchantIds(): Effect.Effect<MerchantIdResource[], unknown>;
  createMerchantId(identifier: string, name: string): Effect.Effect<void, unknown>;
  listPassTypeIds(): Effect.Effect<PassTypeIdResource[], unknown>;
  createPassTypeId(identifier: string, name: string): Effect.Effect<void, unknown>;
};
/** Create each declared identifier of one family that Apple doesn't already have (matched on `identifier`). */
const reconcileFamily = (
  reconcileContext: ReconcileContext,
  label: string,
  existing: Set<string>,
  declared: readonly WalletIdConfig[],
  create: (identifier: string, name: string) => Effect.Effect<void, unknown>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (const { identifier, name } of declared) {
      if (existing.has(identifier)) continue;
      const action = plan(reconcileContext, `register ${label} ${identifier} (${name})`);
      if (!reconcileContext.dryRun)
        yield* create(identifier, name).pipe(
          Effect.match({
            onFailure: (writeFailure) => {
              action.status = 'failed';
              action.error = errorMessage(writeFailure);
            },
            onSuccess: () => {
              action.status = 'applied';
            },
          }),
        );
    }
  });
/** Collect the `identifier`s present on a list of registered ids, for additive matching. */
const identifiersOf = (
  entries: {
    identifier?: string;
  }[],
): Set<string> => {
  return new Set(
    entries.flatMap((entry) => {
      if (entry.identifier) return [entry.identifier];
      return [];
    }),
  );
};
/**
 * Reconcile the team's Apple Pay merchant ids and Wallet pass type ids. Only the families present in the
 * config are read and reconciled. Every write is captured per-action so a single failure never aborts the
 * run.
 */
export const reconcileWalletIds = (
  api: AscWalletApi,
  config: WalletConfig,
  dryRun: boolean,
): Effect.Effect<PlannedAction[], unknown> =>
  Effect.gen(function* () {
    const reconcileContext: ReconcileContext = { actions: [], dryRun };
    if (config.merchantIds && config.merchantIds.length > 0) {
      const merchantIds = yield* api.listMerchantIds();
      const existing = identifiersOf(merchantIds);
      yield* reconcileFamily(
        reconcileContext,
        'Apple Pay merchant id',
        existing,
        config.merchantIds,
        (identifier, name) => api.createMerchantId(identifier, name),
      );
    }
    if (config.passTypeIds && config.passTypeIds.length > 0) {
      const passTypeIds = yield* api.listPassTypeIds();
      const existing = identifiersOf(passTypeIds);
      yield* reconcileFamily(
        reconcileContext,
        'Wallet pass type id',
        existing,
        config.passTypeIds,
        (identifier, name) => api.createPassTypeId(identifier, name),
      );
    }
    return reconcileContext.actions;
  });
/** Decode an untrusted Wallet config document. */
export const parseWalletConfig = (
  rawDocument: unknown,
): Effect.Effect<WalletConfig, StoreSurfaceConfigFailure> =>
  decodeStoreSurfaceConfig(rawDocument, WalletConfigSpec);

/** Read and decode wallet.config.json through Effect Platform. */
export const loadWalletConfig = (configPath: string) =>
  loadStoreSurfaceConfig(configPath, WalletConfigSpec);
