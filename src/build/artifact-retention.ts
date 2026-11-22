import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from '../path-exists.ts';
import { resolveArtifactIndexFilePath } from '../services/platform/paths.ts';
import type { Platform } from '../types/app.ts';
import type {
  BuildArtifact,
  PruneOptions,
  PruneResult,
  PrunedArtifact,
  SizeReport,
} from '../types/artifacts.ts';
import type { LaunchConfig } from '../types/config.ts';
import type { MutableDeep } from '../types/mutable.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

export const DEFAULT_RETENTION_DAYS = 30;
const dayMs = 24 * 60 * 60 * 1000;
const artifactPlatforms: readonly Platform[] = ['ios', 'android', 'tvos', 'macos', 'visionos'];

function resolveArtifactIndexPath(indexPath: string | undefined): string {
  const hasIndexPath = indexPath != null;

  if (hasIndexPath) {
    return indexPath;
  }

  return resolveArtifactIndexFilePath();
}

function isPlatform(candidate: unknown): candidate is Platform {
  return artifactPlatforms.some(function platformMatches(platform: Platform): boolean {
    return platform == candidate;
  });
}

function readArtifactString(field: unknown): string {
  const fieldIsString = typeof field == 'string';

  if (fieldIsString == false) {
    throw new Error('Artifact index row is invalid.');
  }

  return field;
}

function decodeSizeReport(candidate: unknown): SizeReport {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    throw new Error('Artifact index size report is invalid.');
  }

  const artifactBytes = candidateObject['artifactBytes'];
  const bytesAreNumber = typeof artifactBytes == 'number';

  if (bytesAreNumber == false) {
    throw new Error('Artifact index size report is invalid.');
  }

  const entries = candidateObject['entries'];
  const entriesAreList = Array.isArray(entries);

  if (entriesAreList == false) {
    throw new Error('Artifact index size report is invalid.');
  }

  return { artifactBytes, entries };
}

function decodeBuildArtifact(candidate: unknown): BuildArtifact {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    throw new Error('Artifact index row is invalid.');
  }

  const platform = candidateObject['platform'];
  const platformIsKnown = isPlatform(platform);

  if (platformIsKnown == false) {
    throw new Error('Artifact index row is invalid.');
  }

  const pathText = readArtifactString(candidateObject['path']);
  const appName = readArtifactString(candidateObject['appName']);
  const profile = readArtifactString(candidateObject['profile']);
  const version = readArtifactString(candidateObject['version']);
  const createdAt = readArtifactString(candidateObject['createdAt']);
  const buildNumber = candidateObject['buildNumber'];
  const clean = candidateObject['clean'];
  const buildNumberIsNumber = typeof buildNumber == 'number';

  if (buildNumberIsNumber == false) {
    throw new Error('Artifact index row is invalid.');
  }

  const cleanIsBoolean = typeof clean == 'boolean';

  if (cleanIsBoolean == false) {
    throw new Error('Artifact index row is invalid.');
  }

  const buildArtifact: BuildArtifact = {
    path: pathText,
    platform,
    appName,
    profile,
    version,
    buildNumber,
    sizeReport: decodeSizeReport(candidateObject['sizeReport']),
    clean,
    createdAt,
  };
  const hasPrunedAt = Object.hasOwn(candidateObject, 'prunedAt');

  if (hasPrunedAt == false) {
    return buildArtifact;
  }

  const prunedAt = candidateObject['prunedAt'];
  const prunedAtIsMissing = prunedAt == null;

  if (prunedAtIsMissing) {
    return buildArtifact;
  }

  const prunedAtIsString = typeof prunedAt == 'string';

  if (prunedAtIsString == false) {
    throw new Error('Artifact index row is invalid.');
  }

  return { ...buildArtifact, prunedAt };
}

function parseArtifactIndexText(encodedIndex: string): unknown {
  try {
    return JSON.parse(encodedIndex);
  } catch (cause) {
    throw new Error('Artifact index is not valid JSON.', { cause });
  }
}

function isUnknownList(candidate: unknown): candidate is readonly unknown[] {
  return Array.isArray(candidate);
}

function decodeArtifactIndex(encodedIndex: string): readonly BuildArtifact[] {
  const parsedIndex = parseArtifactIndexText(encodedIndex);
  const isList = isUnknownList(parsedIndex);

  if (isList == false) {
    throw new Error('Artifact index must be a list.');
  }

  return parsedIndex.map(decodeBuildArtifact);
}

export async function readArtifactIndex(indexPath?: string): Promise<readonly BuildArtifact[]> {
  const artifactIndexPath = resolveArtifactIndexPath(indexPath);
  const indexExists = await pathExists(artifactIndexPath);

  if (indexExists == false) {
    return [];
  }

  const artifactIndexSource = await readFile(artifactIndexPath, 'utf8');

  return decodeArtifactIndex(artifactIndexSource);
}

/** Persist the artifact index, creating its parent directory first. */
export async function writeArtifactIndex(
  artifactIndex: readonly BuildArtifact[],
  indexPath?: string,
): Promise<void> {
  const artifactIndexPath = resolveArtifactIndexPath(indexPath);
  const parentDirectory = path.dirname(artifactIndexPath);
  await mkdir(parentDirectory, { recursive: true });
  const serialized = JSON.stringify(artifactIndex, null, 2);
  await writeFile(artifactIndexPath, serialized);
}

/** Automatic post-store retention window from config (default 30; 0 disables). */
export function resolveRetentionDays(launchConfig: LaunchConfig): number {
  const configuredRetentionDays = launchConfig.artifactRetentionDays;
  const isUnset = configuredRetentionDays == null;

  if (isUnset) {
    return DEFAULT_RETENTION_DAYS;
  }

  return configuredRetentionDays;
}

/**
 * Explicit `builds prune` window: CLI override wins; config when positive; default when unset or 0
 * so an explicit prune still does work when auto-sweep is disabled.
 */
export function resolveCommandRetentionDays(
  launchConfig: LaunchConfig,
  retentionDaysOverride?: number,
): number {
  const hasOverride = retentionDaysOverride != null;

  if (hasOverride) {
    return retentionDaysOverride;
  }

  const configuredRetentionDays = launchConfig.artifactRetentionDays;
  const isUnset = configuredRetentionDays == null;

  if (isUnset) {
    return DEFAULT_RETENTION_DAYS;
  }

  const isPositive = configuredRetentionDays > 0;

  if (isPositive) {
    return configuredRetentionDays;
  }

  return DEFAULT_RETENTION_DAYS;
}

function artifactAgeDays(buildArtifact: BuildArtifact, currentTime: number): number | null {
  const createdTime = Date.parse(buildArtifact.createdAt);
  const createdTimeIsInvalid = Number.isNaN(createdTime);

  if (createdTimeIsInvalid) {
    return null;
  }

  return (currentTime - createdTime) / dayMs;
}

function artifactGroupKey(buildArtifact: BuildArtifact): string {
  return `${buildArtifact.appName}:${buildArtifact.platform}`;
}

/** Newest artifact per app+platform group (by createdAt). */
function newestArtifactByGroup(
  artifactIndex: readonly BuildArtifact[],
): Map<string, BuildArtifact> {
  const newestByGroup = new Map<string, BuildArtifact>();

  for (const buildArtifact of artifactIndex) {
    const groupKey = artifactGroupKey(buildArtifact);
    const currentNewest = newestByGroup.get(groupKey);
    const hasNewest = currentNewest != null;

    if (hasNewest == false) {
      newestByGroup.set(groupKey, buildArtifact);
      continue;
    }

    const candidateCreated = Date.parse(buildArtifact.createdAt);
    const newestCreated = Date.parse(currentNewest.createdAt);
    const candidateIsNewer = candidateCreated > newestCreated;

    if (candidateIsNewer) {
      newestByGroup.set(groupKey, buildArtifact);
    }
  }

  return newestByGroup;
}

function shouldPruneArtifact(
  buildArtifact: BuildArtifact,
  pruneOptions: Pick<PruneOptions, 'now' | 'retentionDays' | 'app' | 'platform'>,
  isGroupNewest: boolean,
  ageInDays: number | null,
): boolean {
  const retentionIsPositive = pruneOptions.retentionDays > 0;

  if (retentionIsPositive == false) {
    return false;
  }

  const isAlreadyPruned = buildArtifact.prunedAt != null;

  if (isAlreadyPruned) {
    return false;
  }

  if (isGroupNewest) {
    return false;
  }

  const hasAppFilter = pruneOptions.app != null;

  if (hasAppFilter) {
    const appMatches = buildArtifact.appName == pruneOptions.app;

    if (appMatches == false) {
      return false;
    }
  }

  const hasPlatformFilter = pruneOptions.platform != null;

  if (hasPlatformFilter) {
    const platformMatches = buildArtifact.platform == pruneOptions.platform;

    if (platformMatches == false) {
      return false;
    }
  }

  const hasAge = ageInDays != null;

  if (hasAge == false) {
    return false;
  }

  return ageInDays > pruneOptions.retentionDays;
}

/** Split an artifact index by retention + keep-newest-per-app+platform policy. */
export function planPrune(
  artifactIndex: readonly BuildArtifact[],
  pruneOptions: Pick<PruneOptions, 'now' | 'retentionDays' | 'app' | 'platform'>,
): { prune: BuildArtifact[]; keep: BuildArtifact[] } {
  const newestByGroup = newestArtifactByGroup(artifactIndex);
  const artifactsToPrune: BuildArtifact[] = [];
  const artifactsToKeep: BuildArtifact[] = [];

  for (const buildArtifact of artifactIndex) {
    const ageInDays = artifactAgeDays(buildArtifact, pruneOptions.now);
    const isGroupNewest = newestByGroup.get(artifactGroupKey(buildArtifact)) == buildArtifact;
    const shouldPrune = shouldPruneArtifact(buildArtifact, pruneOptions, isGroupNewest, ageInDays);

    if (shouldPrune) {
      artifactsToPrune.push(buildArtifact);
      continue;
    }

    artifactsToKeep.push(buildArtifact);
  }

  return { prune: artifactsToPrune, keep: artifactsToKeep };
}

function prunedArtifactEntry(buildArtifact: BuildArtifact, artifactBytes: number): PrunedArtifact {
  return {
    app: buildArtifact.appName,
    platform: buildArtifact.platform,
    version: buildArtifact.version,
    buildNumber: buildArtifact.buildNumber,
    bytes: artifactBytes,
    path: buildArtifact.path,
  };
}

async function readArtifactBytes(buildArtifact: BuildArtifact): Promise<number> {
  const artifactExists = await pathExists(buildArtifact.path);

  if (artifactExists == false) {
    return buildArtifact.sizeReport.artifactBytes;
  }

  const artifactStat = await stat(buildArtifact.path);

  return Number(artifactStat.size);
}

/** Stamp prunedAt on pruned rows without mutating the source index entries. */
function stampPrunedArtifacts(
  artifactIndex: readonly BuildArtifact[],
  prunedArtifacts: readonly BuildArtifact[],
  prunedAt: string,
): BuildArtifact[] {
  const prunedIdentity = new Set<BuildArtifact>(prunedArtifacts);

  return artifactIndex.map(function stampOne(buildArtifact: BuildArtifact): BuildArtifact {
    const wasPruned = prunedIdentity.has(buildArtifact);

    if (wasPruned == false) {
      return buildArtifact;
    }

    return { ...buildArtifact, prunedAt };
  });
}

function shouldWritePrunedIndex(isDryRun: boolean, prunedCount: number): boolean {
  if (isDryRun) {
    return false;
  }

  return prunedCount > 0;
}

/** Delete eligible artifacts and record the sweep in the artifact index. */
export async function runArtifactPrune(
  pruneOptions: PruneOptions & { indexPath?: string },
): Promise<PruneResult> {
  const artifactIndex = await readArtifactIndex(pruneOptions.indexPath);
  const policyInput: MutableDeep<Pick<PruneOptions, 'now' | 'retentionDays' | 'app' | 'platform'>> =
    {
      now: pruneOptions.now,
      retentionDays: pruneOptions.retentionDays,
    };
  const hasApp = pruneOptions.app != null;

  if (hasApp) {
    policyInput.app = pruneOptions.app;
  }

  const hasPlatform = pruneOptions.platform != null;

  if (hasPlatform) {
    policyInput.platform = pruneOptions.platform;
  }

  const artifactsToPrune = planPrune(artifactIndex, policyInput).prune;
  const prunedEntries: PrunedArtifact[] = [];
  let freedBytes = 0;
  let dryRun = false;
  const dryRunIsSet = pruneOptions.dryRun != null;

  if (dryRunIsSet) {
    dryRun = pruneOptions.dryRun;
  }

  const prunedAt = new Date(pruneOptions.now).toISOString();

  for (const buildArtifact of artifactsToPrune) {
    const artifactBytes = await readArtifactBytes(buildArtifact);
    const prunedArtifact = prunedArtifactEntry(buildArtifact, artifactBytes);
    prunedEntries.push(prunedArtifact);
    freedBytes += artifactBytes;

    if (dryRun) {
      continue;
    }

    const artifactExists = await pathExists(buildArtifact.path);

    if (artifactExists) {
      await rm(buildArtifact.path);
    }
  }

  const shouldStampIndex = shouldWritePrunedIndex(dryRun, prunedEntries.length);

  if (shouldStampIndex) {
    const writtenIndex = stampPrunedArtifacts(artifactIndex, artifactsToPrune, prunedAt);
    await writeArtifactIndex(writtenIndex, pruneOptions.indexPath);
  }

  return { pruned: prunedEntries, freedBytes, dryRun };
}
