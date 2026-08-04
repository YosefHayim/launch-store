import { FileSystem } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import type { AppAvailabilityResource } from '../types/appleCatalog.js';
import type { PlannedAction } from '../types/reconcile.js';
import { appRecordMissing } from './reconcile.js';
import { errorMessage } from '../services/errorMessage.js';
/** How many territory codes to show inline before truncating the plan line. */
const PREVIEW_LIMIT = 8;

const TerritoryCodeSchema = Schema.transform(
  Schema.String,
  Schema.String.pipe(
    Schema.minLength(1, {
      message: () => 'Territory codes must be non-empty strings such as "USA".',
    }),
  ),
  {
    strict: true,
    decode: (territoryCode) => territoryCode.trim().toUpperCase(),
    encode: (territoryCode) => territoryCode,
  },
);

export const AvailabilityConfigSchema = Schema.mutable(
  Schema.Struct({
    availableInNewTerritories: Schema.optionalWith(Schema.Boolean, { exact: true }),
    territories: Schema.mutable(Schema.Array(TerritoryCodeSchema)),
  }),
);

export type AvailabilityConfig = Schema.Schema.Type<typeof AvailabilityConfigSchema>;

/** Reading or decoding availability.config.json failed. */
export type AvailabilityConfigFailure = Readonly<{
  readonly _tag: 'AvailabilityConfigFailure';
  readonly path: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeAvailabilityConfigFailure = Data.tagged<AvailabilityConfigFailure>(
  'AvailabilityConfigFailure',
);
/**
 * The exact slice of {@link AppStoreConnectClient} the availability reconciler depends on. Declared here
 * (rather than the concrete client) so the diff logic is unit-testable with a hand-rolled fake, mirroring
 * {@link AscAccessibilityApi} in `accessibility.ts`.
 */
export type AscAvailabilityApi = {
  getAppId(bundleId: string): Effect.Effect<string | null, unknown>;
  getAppAvailability(appId: string): Effect.Effect<AppAvailabilityResource | null, unknown>;
  createAppAvailability(
    appId: string,
    input: {
      availableInNewTerritories: boolean;
      territories: string[];
    },
  ): Effect.Effect<void, unknown>;
  updateAppAvailabilityTerritories(
    availabilityId: string,
    territories: string[],
  ): Effect.Effect<void, unknown>;
};
/** Inputs to reconcile one app's store availability. */
export type AvailabilityReconcileInput = {
  bundleId: string;
  config: AvailabilityConfig;
  dryRun: boolean;
};
/** Uppercase, trim, and de-duplicate a list of territory codes into a stable set. */
const normalizeTerritories = (territories: string[]): Set<string> => {
  return new Set(territories.map((code) => code.trim().toUpperCase()));
};
/** Sorted difference `a \ b` - codes in `a` not in `b`. */
const difference = (a: Set<string>, b: Set<string>): string[] => {
  return [...a].filter((code) => !b.has(code)).sort();
};
/** A compact, truncated preview of territory codes for the plan line. */
const preview = (codes: string[]): string => {
  if (codes.length <= PREVIEW_LIMIT) return codes.join(', ');
  return `${codes.slice(0, PREVIEW_LIMIT).join(', ')}, ...`;
};
/**
 * Build the human description of the availability change. Names the resulting territory count and the
 * added / removed deltas (and the auto-add flag when it flips), so the plan is legible before applying.
 */
const describeChange = (input: {
  total: number;
  added: string[];
  removed: string[];
  flagChanged: boolean;
  availableInNewTerritories: boolean;
  firstTime: boolean;
  flagRequiresManualUpdate: boolean;
}): string => {
  let territoryLabel = 'territories';
  if (input.total === 1) territoryLabel = 'territory';
  const parts: string[] = [`set store availability -> ${input.total} ${territoryLabel}`];
  if (input.firstTime) parts.push('(first time)');
  if (input.added.length) parts.push(`+${input.added.length} (${preview(input.added)})`);
  if (input.removed.length) parts.push(`-${input.removed.length} (${preview(input.removed)})`);
  if (input.flagChanged) {
    let manualNotice = '';
    if (input.flagRequiresManualUpdate) {
      manualNotice = ' (manual App Store Connect change required)';
    }
    let flagState = 'off';
    if (input.availableInNewTerritories) flagState = 'on';
    parts.push(`auto-add new territories: ${flagState}${manualNotice}`);
  }
  return parts.join(' - ');
};
const immutableFlagMessage = (territoriesChanged: boolean): string => {
  let prefix = '';
  if (territoriesChanged) prefix = 'Territories were updated, but ';
  return `${prefix}Apple's App Store Connect API exposes availableInNewTerritories only when the availability singleton is created. Change that flag manually in App Store Connect.`;
};
/**
 * Reconcile one app's store availability. Throws only for a precondition the user must fix (no App Store
 * Connect app record). Emits a single planned "set availability" action when the desired territory set (or
 * the auto-add flag) differs from Apple's, or nothing when already in sync.
 */
export const reconcileAvailability = (
  api: AscAvailabilityApi,
  input: AvailabilityReconcileInput,
): Effect.Effect<{ bundleId: string; actions: PlannedAction[] }, unknown> =>
  Effect.gen(function* () {
    const appId = yield* api.getAppId(input.bundleId);
    if (!appId) return yield* Effect.fail(appRecordMissing(input.bundleId, 'availability'));
    const desired = normalizeTerritories(input.config.territories);
    const availableInNewTerritories = input.config.availableInNewTerritories === true;
    const current = yield* api.getAppAvailability(appId);
    let currentSet = new Set<string>();
    if (current !== null) currentSet = normalizeTerritories(current.availableTerritories);
    const added = difference(desired, currentSet);
    const removed = difference(currentSet, desired);
    let currentNewTerritoriesFlag = false;
    if (current?.availableInNewTerritories !== undefined) {
      currentNewTerritoriesFlag = current.availableInNewTerritories;
    }
    const flagChanged = currentNewTerritoriesFlag !== availableInNewTerritories;
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
        flagRequiresManualUpdate: current !== null && flagChanged,
      }),
      destructive: removed.length > 0,
      status: 'planned',
    };
    const actions = [action];
    if (input.dryRun) return { bundleId: input.bundleId, actions };
    const desiredTerritories = [...desired].sort();
    if (current) {
      let territoriesChanged = added.length > 0;
      if (!territoriesChanged) territoriesChanged = removed.length > 0;
      if (territoriesChanged) {
        yield* api.updateAppAvailabilityTerritories(current.id, desiredTerritories).pipe(
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
        if (action.status === 'failed') return { bundleId: input.bundleId, actions };
      }
      if (flagChanged) {
        action.status = 'failed';
        action.error = immutableFlagMessage(territoriesChanged);
        return { bundleId: input.bundleId, actions };
      }
    } else {
      yield* api
        .createAppAvailability(appId, {
          availableInNewTerritories,
          territories: desiredTerritories,
        })
        .pipe(
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
    if (action.status === 'planned') action.status = 'applied';
    return { bundleId: input.bundleId, actions };
  });
export const parseAvailabilityConfig = (rawConfig: unknown): AvailabilityConfig =>
  Schema.decodeUnknownSync(AvailabilityConfigSchema)(rawConfig);

export const readAvailabilityConfig = (
  configPath: string,
): Effect.Effect<AvailabilityConfig, AvailabilityConfigFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const configExists = yield* fileSystem.exists(configPath).pipe(
      Effect.mapError((cause) =>
        makeAvailabilityConfigFailure({
          path: configPath,
          message: `Could not inspect availability config at ${configPath}.`,
          cause,
        }),
      ),
    );
    if (!configExists) {
      return yield* Effect.fail(
        makeAvailabilityConfigFailure({
          path: configPath,
          message: `No availability config at ${configPath}. Create one with a "territories" list (see \`launch availability --help\`).`,
          cause: 'missing-availability-config',
        }),
      );
    }
    const configSource = yield* fileSystem.readFileString(configPath).pipe(
      Effect.mapError((cause) =>
        makeAvailabilityConfigFailure({
          path: configPath,
          message: `Could not read availability config at ${configPath}.`,
          cause,
        }),
      ),
    );
    return yield* Schema.decodeUnknown(Schema.parseJson(AvailabilityConfigSchema))(
      configSource,
    ).pipe(
      Effect.mapError((cause) =>
        makeAvailabilityConfigFailure({
          path: configPath,
          message: `Invalid availability config at ${configPath}: ${errorMessage(cause)}`,
          cause,
        }),
      ),
    );
  });
