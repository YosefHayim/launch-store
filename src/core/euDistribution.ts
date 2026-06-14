/**
 * Reconcile the team's **EU alternative-distribution domains** (DMA web distribution / alternative
 * marketplaces) from a declarative `eu-distribution.config.json`, and register the package-signing
 * **public key**, using the App Store Connect API key alone.
 *
 * Under the EU Digital Markets Act, distributing iOS apps outside the App Store requires authorizing the
 * domains you'll host downloads from and registering a public key Apple verifies your signed packages
 * against. Both are repeatable, portal-clicked setup that no tool automates and EAS doesn't touch.
 *
 * These are **team-level** resources (not per-app), so — unlike `core/releaseAttrs.ts` / `core/offers.ts`
 * — there's no app/bundle-id resolution: the reconcile operates directly on the team. Domains are
 * declarative state (this module diffs them); the public key is a register-once action driven by the
 * command's `set-key` subcommand, not reconciled here. The diff is **additive**: declared domains Apple
 * doesn't have yet are created, and an undeclared domain is left untouched (never deleted), so a re-run
 * is safe — removing a domain stays a deliberate App Store Connect action. Mirrors the plan/apply
 * vocabulary (`PlannedAction`) the rest of the store-sync commands share.
 */

import { existsSync, readFileSync } from "node:fs";
import type { AlternativeDistributionDomainResource } from "../apple/ascClient.js";
import type { PlannedAction } from "./ascSync.js";

/** One authorized distribution domain: the host plus a human-readable reference name. */
export interface EuDistributionDomainConfig {
  /** The domain authorized to host distribution packages (e.g. `downloads.acme.com`). */
  domain: string;
  /** A label shown in App Store Connect to identify the domain. */
  referenceName: string;
}

/** The full `eu-distribution.config.json` document. */
export interface EuDistributionConfig {
  /** Domains to authorize for EU alternative distribution. */
  domains: EuDistributionDomainConfig[];
}

/**
 * The exact slice of {@link AppStoreConnectClient} the domain reconciler depends on. Declaring it here
 * (rather than taking the concrete client) keeps the diff logic unit-testable with a hand-rolled fake;
 * `AppStoreConnectClient` satisfies it structurally, mirroring {@link AscReleaseApi} in `releaseAttrs.ts`.
 */
export interface AscEuDistributionApi {
  listAlternativeDistributionDomains(): Promise<AlternativeDistributionDomainResource[]>;
  createAlternativeDistributionDomain(domain: string, referenceName: string): Promise<void>;
}

/** Mutable per-run context threaded through the reconcile walk (mirrors `core/releaseAttrs.ts`). */
interface ReconcileContext {
  actions: PlannedAction[];
  dryRun: boolean;
}

/**
 * Record an action and, unless this is a dry-run, perform it. A thrown error is captured on the action
 * (status `failed`) rather than propagated, so one bad domain never aborts the rest of the walk.
 */
async function act(ctx: ReconcileContext, description: string, run: () => Promise<void>): Promise<void> {
  const action: PlannedAction = { description, destructive: false, status: "planned" };
  ctx.actions.push(action);
  if (ctx.dryRun) return;
  try {
    await run();
    action.status = "applied";
  } catch (error) {
    action.status = "failed";
    action.error = error instanceof Error ? error.message : String(error);
  }
}

/**
 * Reconcile the team's authorized distribution domains: create each declared domain Apple doesn't already
 * have (matched on `domain`), leaving undeclared ones untouched. Every write is captured per-action so a
 * single failure never aborts the run.
 */
export async function reconcileEuDistributionDomains(
  api: AscEuDistributionApi,
  config: EuDistributionConfig,
  dryRun: boolean,
): Promise<PlannedAction[]> {
  const ctx: ReconcileContext = { actions: [], dryRun };
  const existing = new Set(
    (await api.listAlternativeDistributionDomains()).flatMap((entry) => (entry.domain ? [entry.domain] : [])),
  );
  for (const { domain, referenceName } of config.domains) {
    if (existing.has(domain)) continue;
    await act(ctx, `authorize distribution domain ${domain} (${referenceName})`, () =>
      api.createAlternativeDistributionDomain(domain, referenceName),
    );
  }
  return ctx.actions;
}

/** Narrow an unknown value to a plain object, or null. Arrays are rejected so a malformed section fails loudly. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Parse and validate one domain entry, requiring a non-empty `domain` and `referenceName`. */
function parseDomain(raw: unknown, index: number): EuDistributionDomainConfig {
  const record = asRecord(raw);
  if (!record) throw new Error(`eu-distribution.config.json: domains[${index}] must be an object.`);
  const domain = record["domain"];
  const referenceName = record["referenceName"];
  if (typeof domain !== "string" || domain.length === 0) {
    throw new Error(`eu-distribution.config.json: domains[${index}].domain must be a non-empty string.`);
  }
  if (typeof referenceName !== "string" || referenceName.length === 0) {
    throw new Error(`eu-distribution.config.json: domains[${index}].referenceName must be a non-empty string.`);
  }
  return { domain, referenceName };
}

/**
 * Parse and validate a raw `eu-distribution.config.json` value into a typed {@link EuDistributionConfig}.
 * Rejects a non-object document and a missing/empty/non-array `domains`, so a bad file fails loudly
 * instead of silently reconciling nothing.
 */
export function parseEuDistributionConfig(raw: unknown): EuDistributionConfig {
  const record = asRecord(raw);
  if (!record) throw new Error("eu-distribution.config.json must be a JSON object.");

  const domainsRaw = record["domains"];
  if (!Array.isArray(domainsRaw) || domainsRaw.length === 0) {
    throw new Error('eu-distribution.config.json must declare a non-empty "domains" array.');
  }
  return { domains: domainsRaw.map(parseDomain) };
}

/** Read and parse an `eu-distribution.config.json` from disk. */
export function loadEuDistributionConfig(path: string): EuDistributionConfig {
  if (!existsSync(path)) {
    throw new Error(
      `No EU distribution config at ${path}. Create one (see \`launch eu-distribution --help\`) or pass --config.`,
    );
  }
  return parseEuDistributionConfig(JSON.parse(readFileSync(path, "utf8")));
}

/** Tally a report's action statuses for the run summary (mirrors the other store-sync commands). */
export function summarizeEuDistribution(actions: PlannedAction[]): {
  applied: number;
  failed: number;
  skipped: number;
} {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const action of actions) {
    if (action.status === "applied") applied++;
    else if (action.status === "failed") failed++;
    else if (action.status === "skipped") skipped++;
  }
  return { applied, failed, skipped };
}
