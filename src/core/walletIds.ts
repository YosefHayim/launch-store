/**
 * Reconcile the team's **Apple Pay merchant ids** and **Wallet pass type ids** from a declarative
 * `wallet.config.json`, using the App Store Connect API key alone.
 *
 * Both are team-level Identifiers (siblings of bundle ids in Certificates, Identifiers & Profiles):
 * a merchant id (`merchant.com.acme.app`) backs Apple Pay, a pass type id (`pass.com.acme.coupon`) backs
 * a Wallet `.pkpass`. Registering them is portal-clicked setup that fastlane's `spaceship` exposes but
 * EAS doesn't, and they're a prerequisite for the certificates that actually sign payments / passes.
 *
 * Like `core/euDistribution.ts`, these are **team-level** resources, so there's no app/bundle-id
 * resolution — the reconcile operates directly on the team. The diff is **additive**: an identifier Apple
 * doesn't have yet is created (matched on `identifier`); an undeclared one is left untouched (never
 * deleted), so a re-run is safe. Identifiers are immutable once created, so there is no "update" here.
 * Mirrors the plan/apply vocabulary (`PlannedAction`) the rest of the store-sync commands share.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { MerchantIdResource, PassTypeIdResource } from '../apple/ascClient.js';
import { act, type PlannedAction, type ReconcileContext } from './asc/storeSync.js';
import { asRecord } from './json.js';
import type { WalletConfig, WalletIdConfig } from './types.js';

/**
 * The exact slice of {@link AppStoreConnectClient} the wallet reconciler depends on. Declaring it here
 * (rather than taking the concrete client) keeps the diff logic unit-testable with a hand-rolled fake;
 * `AppStoreConnectClient` satisfies it structurally, mirroring {@link AscEuDistributionApi}.
 */
export interface AscWalletApi {
  listMerchantIds(): Promise<MerchantIdResource[]>;
  createMerchantId(identifier: string, name: string): Promise<void>;
  listPassTypeIds(): Promise<PassTypeIdResource[]>;
  createPassTypeId(identifier: string, name: string): Promise<void>;
}

/** Create each declared identifier of one family that Apple doesn't already have (matched on `identifier`). */
async function reconcileFamily(
  ctx: ReconcileContext,
  label: string,
  existing: Set<string>,
  declared: WalletIdConfig[],
  create: (identifier: string, name: string) => Promise<void>,
): Promise<void> {
  for (const { identifier, name } of declared) {
    if (existing.has(identifier)) continue;
    await act(ctx, `register ${label} ${identifier} (${name})`, () => create(identifier, name));
  }
}

/** Collect the `identifier`s present on a list of registered ids, for additive matching. */
function identifiersOf(entries: { identifier?: string }[]): Set<string> {
  return new Set(entries.flatMap((entry) => (entry.identifier ? [entry.identifier] : [])));
}

/**
 * Reconcile the team's Apple Pay merchant ids and Wallet pass type ids. Only the families present in the
 * config are read and reconciled. Every write is captured per-action so a single failure never aborts the
 * run.
 */
export async function reconcileWalletIds(
  api: AscWalletApi,
  config: WalletConfig,
  dryRun: boolean,
): Promise<PlannedAction[]> {
  const ctx: ReconcileContext = { actions: [], dryRun };

  if (config.merchantIds && config.merchantIds.length > 0) {
    const existing = identifiersOf(await api.listMerchantIds());
    await reconcileFamily(ctx, 'Apple Pay merchant id', existing, config.merchantIds, (id, name) =>
      api.createMerchantId(id, name),
    );
  }
  if (config.passTypeIds && config.passTypeIds.length > 0) {
    const existing = identifiersOf(await api.listPassTypeIds());
    await reconcileFamily(ctx, 'Wallet pass type id', existing, config.passTypeIds, (id, name) =>
      api.createPassTypeId(id, name),
    );
  }
  return ctx.actions;
}

/** Parse and validate one identifier entry of `family`, requiring a non-empty `identifier` and `name`. */
function parseId(raw: unknown, family: string, index: number): WalletIdConfig {
  const record = asRecord(raw);
  if (!record) throw new Error(`wallet.config.json: ${family}[${index}] must be an object.`);
  const identifier = record['identifier'];
  const name = record['name'];
  if (typeof identifier !== 'string' || identifier.length === 0) {
    throw new Error(
      `wallet.config.json: ${family}[${index}].identifier must be a non-empty string.`,
    );
  }
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`wallet.config.json: ${family}[${index}].name must be a non-empty string.`);
  }
  return { identifier, name };
}

/** Parse one family ("merchantIds" / "passTypeIds") as an array of {@link WalletIdConfig}, or undefined when absent. */
function parseFamily(raw: unknown, family: string): WalletIdConfig[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error(`wallet.config.json: ${family} must be an array.`);
  return raw.map((entry, index) => parseId(entry, family, index));
}

/**
 * Parse and validate a raw `wallet.config.json` value into a typed {@link WalletConfig}. Rejects a
 * non-object document and a file declaring neither family, so a bad file fails loudly instead of
 * silently reconciling nothing.
 */
export function parseWalletConfig(raw: unknown): WalletConfig {
  const record = asRecord(raw);
  if (!record) throw new Error('wallet.config.json must be a JSON object.');

  const config: WalletConfig = {};
  const merchantIds = parseFamily(record['merchantIds'], 'merchantIds');
  if (merchantIds) config.merchantIds = merchantIds;
  const passTypeIds = parseFamily(record['passTypeIds'], 'passTypeIds');
  if (passTypeIds) config.passTypeIds = passTypeIds;

  if ((config.merchantIds?.length ?? 0) === 0 && (config.passTypeIds?.length ?? 0) === 0) {
    throw new Error(
      'wallet.config.json must declare at least one entry under "merchantIds" or "passTypeIds".',
    );
  }
  return config;
}

/** Read and parse a `wallet.config.json` from disk. */
export function loadWalletConfig(path: string): WalletConfig {
  if (!existsSync(path)) {
    throw new Error(
      `No wallet config at ${path}. Create one (see \`launch wallet --help\`) or pass --config.`,
    );
  }
  return parseWalletConfig(JSON.parse(readFileSync(path, 'utf8')));
}
