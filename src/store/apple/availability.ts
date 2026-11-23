// Reconciles the territories where an app is available on App Store Connect.

import { readFile } from 'node:fs/promises';
import type { AppAvailabilityResource } from '@/types/apple-catalog.js';
import type { MutableDeep } from '@/types/mutable.js';
import type { PlannedAction } from '@/types/reconcile.js';
import { pathExists } from '@/path-exists.js';
import { appRecordMissing } from '../shared/reconcile.ts';
import { errorMessage } from '@/services/platform/error-message.js';
import { readPlainObject } from '@/services/platform/plain-object.js';

/** How many territory codes to show inline before truncating the plan line. */
const PREVIEW_LIMIT = 8;

type AvailabilityConfig = {
  availableInNewTerritories?: boolean;
  territories: string[];
};

/** Reading or decoding availability.config.json failed. */
type AvailabilityConfigFailure = Readonly<{
  readonly _tag: 'AvailabilityConfigFailure';
  readonly path: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function makeAvailabilityConfigFailure(fields: {
  path: string;
  message: string;
  cause: unknown;
}): AvailabilityConfigFailure {
  return { _tag: 'AvailabilityConfigFailure', ...fields };
}

/** The exact slice of App Store Connect the availability reconciler depends on. */
export type AscAvailabilityApi = {
  getAppId(bundleId: string): Promise<string | null>;

  getAppAvailability(appId: string): Promise<AppAvailabilityResource | null>;

  createAppAvailability(
    appId: string,
    availability: {
      availableInNewTerritories: boolean;
      territories: string[];
    },
  ): Promise<void>;

  updateAppAvailabilityTerritories(availabilityId: string, territories: string[]): Promise<void>;
};

/** Inputs to reconcile one app's store availability. */
type AvailabilityReconcileInput = {
  bundleId: string;
  config: AvailabilityConfig;
  dryRun: boolean;
};

function readTerritoryCode(entry: unknown): string {
  const isText = typeof entry == 'string';

  if (isText == false) {
    throw new Error('Territory codes must be non-empty strings such as "USA".');
  }

  const territoryCode = entry.trim().toUpperCase();

  const isEmpty = territoryCode.length == 0;

  if (isEmpty) {
    throw new Error('Territory codes must be non-empty strings such as "USA".');
  }

  return territoryCode;
}

export function parseAvailabilityConfig(rawConfig: unknown): AvailabilityConfig {
  const rawConfigObject = readPlainObject(rawConfig);

  if (rawConfigObject == null) {
    throw new Error('availability.config.json must be a JSON object.');
  }

  const hasTerritories = Object.hasOwn(rawConfigObject, 'territories');

  if (hasTerritories == false) {
    throw new Error('Expected territories to be an array.');
  }

  const territoriesField = rawConfigObject['territories'];
  const isTerritoryList = Array.isArray(territoriesField);

  if (isTerritoryList == false) {
    throw new Error('Expected territories to be an array.');
  }

  const territories: string[] = [];

  for (const entry of territoriesField) {
    const territoryCode = readTerritoryCode(entry);
    territories.push(territoryCode);
  }

  const availabilityConfig: AvailabilityConfig = { territories };
  const hasFlag = Object.hasOwn(rawConfigObject, 'availableInNewTerritories');

  if (hasFlag == false) {
    return availabilityConfig;
  }

  const flag = rawConfigObject['availableInNewTerritories'];
  const isFlag = typeof flag == 'boolean';

  if (isFlag == false) {
    throw new Error('Expected availableInNewTerritories to be a boolean.');
  }

  availabilityConfig.availableInNewTerritories = flag;

  return availabilityConfig;
}

/** Read and decode availability.config.json. */
export async function readAvailabilityConfig(configPath: string): Promise<AvailabilityConfig> {
  let configExists = false;

  try {
    configExists = await pathExists(configPath);
  } catch (cause) {
    throw makeAvailabilityConfigFailure({
      path: configPath,
      message: `Could not inspect availability config at ${configPath}.`,
      cause,
    });
  }

  if (configExists == false) {
    throw makeAvailabilityConfigFailure({
      path: configPath,
      message: `No availability config at ${configPath}. Create one with a "territories" list (see \`launch-store availability --help\`).`,
      cause: 'missing-availability-config',
    });
  }

  let configSource = '';

  try {
    configSource = await readFile(configPath, 'utf8');
  } catch (cause) {
    throw makeAvailabilityConfigFailure({
      path: configPath,
      message: `Could not read availability config at ${configPath}.`,
      cause,
    });
  }

  try {
    const rawConfig: unknown = JSON.parse(configSource);
    return parseAvailabilityConfig(rawConfig);
  } catch (cause) {
    const failureMessage = errorMessage(cause);

    throw makeAvailabilityConfigFailure({
      path: configPath,
      message: `Invalid availability config at ${configPath}: ${failureMessage}`,
      cause,
    });
  }
}

function normalizeTerritory(territoryCode: string): string {
  return territoryCode.trim().toUpperCase();
}

/** Uppercase, trim, and de-duplicate a list of territory codes into a stable set. */
function normalizeTerritories(territories: readonly string[]): Set<string> {
  return new Set(territories.map(normalizeTerritory));
}

function isOutside(excluded: Set<string>, territoryCode: string): boolean {
  return excluded.has(territoryCode) == false;
}

/** Sorted difference of codes in `included` that are not in `excluded`. */
function difference(included: Set<string>, excluded: Set<string>): string[] {
  const missing: string[] = [];

  for (const territoryCode of included) {
    const isMissing = isOutside(excluded, territoryCode);

    if (isMissing) {
      missing.push(territoryCode);
    }
  }

  missing.sort();

  return missing;
}

/** A compact, truncated preview of territory codes for the plan line. */
function preview(codes: string[]): string {
  const fitsInline = codes.length <= PREVIEW_LIMIT;

  if (fitsInline) {
    return codes.join(', ');
  }

  return `${codes.slice(0, PREVIEW_LIMIT).join(', ')}, ...`;
}

type AvailabilityChange = {
  total: number;
  added: string[];
  removed: string[];
  flagChanged: boolean;
  availableInNewTerritories: boolean;
  firstTime: boolean;
  flagRequiresManualUpdate: boolean;
};

/** Build the human description of the availability change. */
function describeChange(change: AvailabilityChange): string {
  let territoryLabel = 'territories';

  const isSingleTerritory = change.total == 1;

  if (isSingleTerritory) {
    territoryLabel = 'territory';
  }

  const parts: string[] = [`set store availability -> ${change.total} ${territoryLabel}`];

  if (change.firstTime) {
    parts.push('(first time)');
  }

  const hasAdded = change.added.length > 0;

  if (hasAdded) {
    parts.push(`+${change.added.length} (${preview(change.added)})`);
  }

  const hasRemoved = change.removed.length > 0;

  if (hasRemoved) {
    parts.push(`-${change.removed.length} (${preview(change.removed)})`);
  }

  const flagFlipped = change.flagChanged == true;

  if (flagFlipped) {
    let flagState = 'off';

    const flagIsOn = change.availableInNewTerritories == true;

    if (flagIsOn) {
      flagState = 'on';
    }

    let notice = '';

    const needsManualUpdate = change.flagRequiresManualUpdate == true;

    if (needsManualUpdate) {
      notice = ' (manual App Store Connect change required)';
    }

    parts.push(`auto-add new territories: ${flagState}${notice}`);
  }

  return parts.join(' - ');
}

function immutableFlagMessage(territoriesChanged: boolean): string {
  let prefix = '';

  if (territoriesChanged) {
    prefix = 'Territories were updated, but ';
  }

  return `${prefix}Apple's App Store Connect API exposes availableInNewTerritories only when the availability singleton is created. Change that flag manually in App Store Connect.`;
}

function isAlreadyInSync(
  current: AppAvailabilityResource | null,
  added: string[],
  removed: string[],
  flagChanged: boolean,
): boolean {
  if (current == null) {
    return false;
  }

  if (added.length != 0) {
    return false;
  }

  if (removed.length != 0) {
    return false;
  }

  return flagChanged == false;
}

function flagNeedsManualUpdate(
  current: AppAvailabilityResource | null,
  flagChanged: boolean,
): boolean {
  if (current == null) {
    return false;
  }

  return flagChanged;
}

async function applyTerritoryUpdate(
  api: AscAvailabilityApi,
  action: MutableDeep<PlannedAction>,
  availabilityId: string,
  desiredTerritories: string[],
): Promise<boolean> {
  try {
    await api.updateAppAvailabilityTerritories(availabilityId, desiredTerritories);
    action.status = 'applied';
    return true;
  } catch (writeFailure) {
    action.status = 'failed';
    action.error = errorMessage(writeFailure);
    return false;
  }
}

async function applyAvailabilityCreate(
  api: AscAvailabilityApi,
  action: MutableDeep<PlannedAction>,
  appId: string,
  availableInNewTerritories: boolean,
  desiredTerritories: string[],
): Promise<void> {
  try {
    await api.createAppAvailability(appId, {
      availableInNewTerritories,
      territories: desiredTerritories,
    });
    action.status = 'applied';
  } catch (writeFailure) {
    action.status = 'failed';
    action.error = errorMessage(writeFailure);
  }
}

/** Reconcile one app's store availability. */
export async function reconcileAvailability(
  api: AscAvailabilityApi,
  reconcileInput: AvailabilityReconcileInput,
): Promise<{ bundleId: string; actions: PlannedAction[] }> {
  const appId = await api.getAppId(reconcileInput.bundleId);

  const isAppMissing = appId == null;

  if (isAppMissing) {
    throw appRecordMissing(reconcileInput.bundleId, 'availability');
  }

  const desired = normalizeTerritories(reconcileInput.config.territories);
  const availableInNewTerritories = reconcileInput.config.availableInNewTerritories == true;
  const current = await api.getAppAvailability(appId);
  let currentSet = new Set<string>();

  const hasCurrentTerritories = current != null;

  if (hasCurrentTerritories) {
    currentSet = normalizeTerritories(current.availableTerritories);
  }

  const added = difference(desired, currentSet);
  const removed = difference(currentSet, desired);
  let currentNewTerritoriesFlag = false;
  const currentFlag = current?.availableInNewTerritories;

  const hasCurrentFlag = currentFlag != null;

  if (hasCurrentFlag) {
    currentNewTerritoriesFlag = currentFlag;
  }

  const flagChanged = currentNewTerritoriesFlag != availableInNewTerritories;

  const alreadyInSync = isAlreadyInSync(current, added, removed, flagChanged);

  if (alreadyInSync) {
    return { bundleId: reconcileInput.bundleId, actions: [] };
  }

  const action: MutableDeep<PlannedAction> = {
    description: describeChange({
      total: desired.size,
      added,
      removed,
      flagChanged,
      availableInNewTerritories,
      firstTime: current == null,
      flagRequiresManualUpdate: flagNeedsManualUpdate(current, flagChanged),
    }),
    destructive: removed.length > 0,
    status: 'planned',
  };
  const actions = [action];

  const isDryRun = reconcileInput.dryRun == true;

  if (isDryRun) {
    return { bundleId: reconcileInput.bundleId, actions };
  }

  const desiredTerritories = [...desired].sort();

  if (hasCurrentTerritories) {
    let territoriesChanged = added.length > 0;
    const removedSome = removed.length > 0;

    if (territoriesChanged == false) {
      territoriesChanged = removedSome;
    }

    if (territoriesChanged) {
      const updated = await applyTerritoryUpdate(api, action, current.id, desiredTerritories);

      const updateFailed = updated == false;

      if (updateFailed) {
        return { bundleId: reconcileInput.bundleId, actions };
      }
    }

    if (flagChanged) {
      action.status = 'failed';
      action.error = immutableFlagMessage(territoriesChanged);
      return { bundleId: reconcileInput.bundleId, actions };
    }
  }

  const needsCreate = hasCurrentTerritories == false;

  if (needsCreate) {
    await applyAvailabilityCreate(
      api,
      action,
      appId,
      availableInNewTerritories,
      desiredTerritories,
    );
  }

  const stillPlanned = action.status == 'planned';

  if (stillPlanned) {
    action.status = 'applied';
  }

  return { bundleId: reconcileInput.bundleId, actions };
}
