/**
 * Reconcile an app's **store availability** — the exact set of App Store territories it sells in, plus
 * whether it auto-enables in territories Apple adds later — from a declarative `availability.config.json`,
 * using the App Store Connect API key alone. Choosing the storefronts is click-heavy App Store Connect
 * work that EAS doesn't touch.
 *
 * Apple's v2 availability is a per-app singleton: setting it replaces the whole territory list in one POST
 * (see {@link AppStoreConnectClient.setAppAvailability}). So this reconciler does a single read-vs-desired
 * diff and, when they differ, emits **one** atomic "set availability" action — there's no per-territory
 * apply to isolate. A re-run with no change is a no-op. Pulling the app from territories it currently
 * sells in is flagged `destructive`, since it removes the app from sale there.
 *
 * Mirrors the plan→apply shape of {@link reconcileAccessibility `core/accessibility.ts`}: a read-only PLAN
 * pass builds the {@link PlannedAction}, the command prints it, then an APPLY pass performs it.
 */

import { existsSync, readFileSync } from "node:fs";
import type { AppAvailabilityResource } from "../apple/ascClient.js";
import type { PlannedAction } from "./ascSync.js";

/** How many territory codes to show inline before truncating the plan line. */
const PREVIEW_LIMIT = 8;

/** The `availability.config.json` document. */
export interface AvailabilityConfig {
  /** Auto-enable the app in territories Apple adds in the future (default false). */
  availableInNewTerritories?: boolean;
  /** The Apple territory codes the app should sell in (e.g. `["USA", "GBR", "CAN"]`); at least one. */
  territories: string[];
}

/**
 * The exact slice of {@link AppStoreConnectClient} the availability reconciler depends on. Declared here
 * (rather than the concrete client) so the diff logic is unit-testable with a hand-rolled fake, mirroring
 * {@link AscAccessibilityApi} in `accessibility.ts`.
 */
export interface AscAvailabilityApi {
  getAppId(bundleId: string): Promise<string | null>;
  getAppAvailability(appId: string): Promise<AppAvailabilityResource | null>;
  setAppAvailability(
    appId: string,
    input: { availableInNewTerritories: boolean; territories: string[] },
  ): Promise<void>;
}

/** Inputs to reconcile one app's store availability. */
export interface AvailabilityReconcileInput {
  /** The app's iOS bundle id — resolves the App Store Connect app record. */
  bundleId: string;
  config: AvailabilityConfig;
  /** Rehearse only: read state and build the plan, perform no writes. */
  dryRun: boolean;
}

/** The actionable error when an app has no App Store Connect record (Apple has no API to create one). */
function appRecordMissing(bundleId: string): Error {
  return new Error(
    `No App Store Connect app record for ${bundleId}. Create the app once in App Store Connect ` +
      `(Apple has no API to create the app record), then re-run \`launch availability\`.`,
  );
}

/** Uppercase, trim, and de-duplicate a list of territory codes into a stable set. */
function normalizeTerritories(territories: string[]): Set<string> {
  return new Set(territories.map((code) => code.trim().toUpperCase()));
}

/** Sorted difference `a \ b` — codes in `a` not in `b`. */
function difference(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((code) => !b.has(code)).sort();
}

/** A compact, truncated preview of territory codes for the plan line. */
function preview(codes: string[]): string {
  if (codes.length <= PREVIEW_LIMIT) return codes.join(", ");
  return `${codes.slice(0, PREVIEW_LIMIT).join(", ")}, …`;
}

/**
 * Build the human description of the availability change. Names the resulting territory count and the
 * added / removed deltas (and the auto-add flag when it flips), so the plan is legible before applying.
 */
function describeChange(input: {
  total: number;
  added: string[];
  removed: string[];
  flagChanged: boolean;
  availableInNewTerritories: boolean;
  firstTime: boolean;
}): string {
  const parts: string[] = [`set store availability → ${input.total} territor${input.total === 1 ? "y" : "ies"}`];
  if (input.firstTime) parts.push("(first time)");
  if (input.added.length) parts.push(`+${input.added.length} (${preview(input.added)})`);
  if (input.removed.length) parts.push(`−${input.removed.length} (${preview(input.removed)})`);
  if (input.flagChanged) parts.push(`auto-add new territories: ${input.availableInNewTerritories ? "on" : "off"}`);
  return parts.join(" · ");
}

/**
 * Reconcile one app's store availability. Throws only for a precondition the user must fix (no App Store
 * Connect app record). Emits a single atomic "set availability" action when the desired territory set (or
 * the auto-add flag) differs from Apple's, or nothing when already in sync.
 */
export async function reconcileAvailability(
  api: AscAvailabilityApi,
  input: AvailabilityReconcileInput,
): Promise<{ bundleId: string; actions: PlannedAction[] }> {
  const appId = await api.getAppId(input.bundleId);
  if (!appId) throw appRecordMissing(input.bundleId);

  const desired = normalizeTerritories(input.config.territories);
  const availableInNewTerritories = input.config.availableInNewTerritories === true;

  const current = await api.getAppAvailability(appId);
  const currentSet = current ? normalizeTerritories(current.availableTerritories) : new Set<string>();
  const added = difference(desired, currentSet);
  const removed = difference(currentSet, desired);
  const flagChanged = (current?.availableInNewTerritories ?? false) !== availableInNewTerritories;

  if (current && added.length === 0 && removed.length === 0 && !flagChanged) {
    return { bundleId: input.bundleId, actions: [] };
  }

  const action: PlannedAction = {
    description: describeChange({
      total: desired.size,
      added,
      removed,
      flagChanged,
      availableInNewTerritories,
      firstTime: !current,
    }),
    destructive: removed.length > 0,
    status: "planned",
  };
  const actions = [action];

  if (input.dryRun) return { bundleId: input.bundleId, actions };

  try {
    await api.setAppAvailability(appId, { availableInNewTerritories, territories: [...desired].sort() });
    action.status = "applied";
  } catch (error) {
    action.status = "failed";
    action.error = error instanceof Error ? error.message : String(error);
  }
  return { bundleId: input.bundleId, actions };
}

/** Narrow an unknown value to a plain object, or null. Arrays are rejected so a malformed section fails loudly. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Parse and validate a raw `availability.config.json` value into a typed {@link AvailabilityConfig}.
 * Rejects a non-object document, a missing/empty `territories` array, and a non-string code so a bad file
 * fails loudly instead of silently pulling the app from every storefront.
 */
export function parseAvailabilityConfig(raw: unknown): AvailabilityConfig {
  const record = asRecord(raw);
  if (!record) throw new Error("availability.config.json must be a JSON object.");

  const rawTerritories = record["territories"];
  if (!Array.isArray(rawTerritories)) {
    throw new Error('availability.config.json: "territories" must be an array of Apple territory codes.');
  }
  const territories: string[] = [];
  for (const [index, code] of rawTerritories.entries()) {
    if (typeof code !== "string" || code.trim().length === 0) {
      throw new Error(`availability.config.json: territories[${index}] must be a non-empty string (e.g. "USA").`);
    }
    territories.push(code.trim().toUpperCase());
  }
  if (territories.length === 0) {
    throw new Error('availability.config.json: "territories" must list at least one territory code.');
  }

  const config: AvailabilityConfig = { territories };
  const flag = record["availableInNewTerritories"];
  if (flag !== undefined) {
    if (typeof flag !== "boolean") {
      throw new Error('availability.config.json: "availableInNewTerritories" must be a boolean.');
    }
    config.availableInNewTerritories = flag;
  }
  return config;
}

/** Read and parse an `availability.config.json` from disk. */
export function loadAvailabilityConfig(path: string): AvailabilityConfig {
  if (!existsSync(path)) {
    throw new Error(
      `No availability config at ${path}. Create one with a "territories" list (see \`launch availability --help\`).`,
    );
  }
  return parseAvailabilityConfig(JSON.parse(readFileSync(path, "utf8")));
}
