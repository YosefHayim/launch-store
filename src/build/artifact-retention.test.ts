import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BuildArtifact } from '../types/artifacts.ts';
import type { LaunchConfig } from '../types/config.ts';
import {
  DEFAULT_RETENTION_DAYS,
  planPrune,
  readArtifactIndex,
  readCommandRetentionDays,
  readRetentionDays,
  runArtifactPrune,
  writeArtifactIndex,
} from './artifact-retention.ts';
const dayMs = 24 * 60 * 60 * 1000;
/** A fixed reference "now" so age math is deterministic (no wall clock in the tests). */
const NOW = Date.parse('2026-06-15T00:00:00.000Z');

/** ISO stamp for a build created `days` before {@link NOW}. */
function daysAgo(days: number): string {
  return new Date(NOW - days * dayMs).toISOString();
}

/** A stored-build fixture; override any field to vary one dimension under test. */
function artifact(overrides: Partial<BuildArtifact> = {}): BuildArtifact {
  return {
    path: '/tmp/demo-1.0.0-7-ios.ipa',
    platform: 'ios',
    appName: 'demo',
    profile: 'production',
    version: '1.0.0',
    buildNumber: 7,
    sizeReport: { artifactBytes: 10, entries: [] },
    clean: true,
    createdAt: daysAgo(1),
    ...overrides,
  };
}

/** A minimal valid config; retention helpers only read `artifactRetentionDays`. */
function config(overrides: Partial<LaunchConfig> = {}): LaunchConfig {
  return {
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
    profiles: {},
    ...overrides,
  };
}

async function runArtifactEffect<Success>(artifactWork: Promise<Success>): Promise<Success> {
  return await artifactWork;
}

function describePlanPruneTheKeepNewestPerAppPlatformPolicy() {
  function prunesABuildPastTheWindowButKeepsTheNewestOfItsAppPlatform() {
    const pastDate = daysAgo(2);
    const newest = artifact({ buildNumber: 9, createdAt: pastDate });
    const old = artifact({ buildNumber: 7, createdAt: daysAgo(40) });
    const { prune, keep } = planPrune([newest, old], { now: NOW, retentionDays: 30 });

    expect(prune).toEqual([old]);
    expect(keep).toEqual([newest]);
  }

  it(
    'prunes a build past the window but keeps the newest of its app+platform',
    prunesABuildPastTheWindowButKeepsTheNewestOfItsAppPlatform,
  );

  function neverPrunesTheNewestBuildEvenWhenItIsItselfPastTheWindow() {
    const pastDate = daysAgo(40);
    const newest = artifact({ buildNumber: 9, createdAt: pastDate });
    const older = artifact({ buildNumber: 7, createdAt: daysAgo(60) });
    const { prune, keep } = planPrune([newest, older], { now: NOW, retentionDays: 30 });

    expect(prune).toEqual([older]); // the newest survives despite being 40d old
    expect(keep).toContain(newest);
  }

  it(
    'never prunes the newest build even when it is itself past the window',
    neverPrunesTheNewestBuildEvenWhenItIsItselfPastTheWindow,
  );

  function keepsTheNewestOfEACHAppPlatformGroupIndependently() {
    const pastDate = daysAgo(40);
    const iosNew = artifact({
      appName: 'a',
      platform: 'ios',
      buildNumber: 9,
      createdAt: pastDate,
    });
    const iosOld = artifact({
      appName: 'a',
      platform: 'ios',
      buildNumber: 8,
      createdAt: daysAgo(50),
    });
    const androidNew = artifact({
      appName: 'a',
      platform: 'android',
      buildNumber: 5,
      createdAt: daysAgo(40),
    });
    const { prune } = planPrune([iosNew, iosOld, androidNew], { now: NOW, retentionDays: 30 });

    expect(prune).toEqual([iosOld]); // each group's newest (iosNew, androidNew) is kept
  }

  it(
    'keeps the newest of EACH app+platform group independently',
    keepsTheNewestOfEACHAppPlatformGroupIndependently,
  );

  function prunesNothingInsideTheWindow() {
    const pastDate = daysAgo(2);
    const builds = [
      artifact({ buildNumber: 9, createdAt: pastDate }),
      artifact({ buildNumber: 7, createdAt: daysAgo(10) }),
    ];
    const prune = planPrune(builds, { now: NOW, retentionDays: 30 });

    expect(prune.prune).toEqual([]);
  }

  it('prunes nothing inside the window', prunesNothingInsideTheWindow);

  function treatsRetentionDays0AsDisabledPrunesNothing() {
    const pastDate = daysAgo(2);
    const builds = [
      artifact({ buildNumber: 9, createdAt: pastDate }),
      artifact({ buildNumber: 7, createdAt: daysAgo(99) }),
    ];
    const prune = planPrune(builds, { now: NOW, retentionDays: 0 });

    expect(prune.prune).toEqual([]);
  }

  it(
    'treats retentionDays <= 0 as disabled (prunes nothing)',
    treatsRetentionDays0AsDisabledPrunesNothing,
  );

  function skipsAPieceWhoseBinaryWasAlreadyPruned() {
    const pastDate = daysAgo(2);
    const newest = artifact({ buildNumber: 9, createdAt: pastDate });
    const alreadyGone = artifact({ buildNumber: 7, createdAt: daysAgo(40), prunedAt: daysAgo(5) });
    const prune = planPrune([newest, alreadyGone], { now: NOW, retentionDays: 30 });

    expect(prune.prune).toEqual([]);
  }

  it('skips a row whose binary was already pruned', skipsAPieceWhoseBinaryWasAlreadyPruned);

  function neverPrunesAPieceWithAMissingUnparseableCreatedAtCanTAgeItKeepIt() {
    const pastDate = daysAgo(2);
    const newest = artifact({ buildNumber: 9, createdAt: pastDate });
    const undated = artifact({ buildNumber: 7, createdAt: 'not-a-date' });
    const prune = planPrune([newest, undated], { now: NOW, retentionDays: 30 });

    expect(prune.prune).toEqual([]);
  }

  it(
    "never prunes a row with a missing/unparseable createdAt (can't age it -> keep it)",
    neverPrunesAPieceWithAMissingUnparseableCreatedAtCanTAgeItKeepIt,
  );

  function limitsTheSweepToTheNamedAppLeavingOtherAppsUntouched() {
    const pastDate = daysAgo(2);
    const aNew = artifact({ appName: 'a', buildNumber: 9, createdAt: pastDate });
    const aOld = artifact({ appName: 'a', buildNumber: 8, createdAt: daysAgo(40) });
    const bOld = artifact({ appName: 'b', buildNumber: 3, createdAt: daysAgo(40) });
    const bOlder = artifact({ appName: 'b', buildNumber: 2, createdAt: daysAgo(50) });
    const { prune, keep } = planPrune([aNew, aOld, bOld, bOlder], {
      now: NOW,
      retentionDays: 30,
      app: 'a',
    });

    expect(prune).toEqual([aOld]);
    expect(keep).toEqual(expect.arrayContaining([bOld, bOlder])); // app b not considered at all
  }

  it(
    'limits the sweep to the named app, leaving other apps untouched',
    limitsTheSweepToTheNamedAppLeavingOtherAppsUntouched,
  );

  function limitsTheSweepToTheNamedPlatform() {
    const pastDate = daysAgo(40);
    const iosOld = artifact({ buildNumber: 9, platform: 'ios', createdAt: pastDate });
    const iosOlder = artifact({ buildNumber: 8, platform: 'ios', createdAt: daysAgo(50) });
    const androidOld = artifact({ buildNumber: 4, platform: 'android', createdAt: daysAgo(40) });
    const androidOlder = artifact({ buildNumber: 3, platform: 'android', createdAt: daysAgo(50) });
    const { prune } = planPrune([iosOld, iosOlder, androidOld, androidOlder], {
      now: NOW,
      retentionDays: 30,
      platform: 'android',
    });

    expect(prune).toEqual([androidOlder]); // only android considered; its newest (androidOld) kept
  }

  it('limits the sweep to the named platform', limitsTheSweepToTheNamedPlatform);
}

describe(
  'planPrune - the keep-newest-per-app+platform policy',
  describePlanPruneTheKeepNewestPerAppPlatformPolicy,
);

function describeResolveRetentionDaysTheAutomaticSweepSWindow() {
  function defaultsTo30WhenUnset() {
    const retentionDays = readRetentionDays(config());
    expect(retentionDays).toBe(DEFAULT_RETENTION_DAYS);
  }

  it('defaults to 30 when unset', defaultsTo30WhenUnset);

  function returnsAConfiguredPieceVerbatim() {
    const retentionDays = readRetentionDays(config({ artifactRetentionDays: 14 }));
    expect(retentionDays).toBe(14);
  }

  it('returns a configured value verbatim', returnsAConfiguredPieceVerbatim);

  function returns0WhenExplicitlyDisabledThePipelineReadsThisAsSkip() {
    const retentionDays = readRetentionDays(config({ artifactRetentionDays: 0 }));
    expect(retentionDays).toBe(0);
  }

  it(
    "returns 0 when explicitly disabled (the pipeline reads this as 'skip')",
    returns0WhenExplicitlyDisabledThePipelineReadsThisAsSkip,
  );
}

describe(
  "readRetentionDays - the automatic sweep's window",
  describeResolveRetentionDaysTheAutomaticSweepSWindow,
);

function describeResolveCommandRetentionDaysTheExplicitBuildsPruneWindow() {
  function usesTheConfiguredPieceWhenNoOverrideIsGiven() {
    const commandRetentionDays = readCommandRetentionDays(config({ artifactRetentionDays: 14 }));
    expect(commandRetentionDays).toBe(14);
  }

  it(
    'uses the configured value when no override is given',
    usesTheConfiguredPieceWhenNoOverrideIsGiven,
  );

  function letsADaysOverrideWinOverPiece() {
    const commandRetentionDays = readCommandRetentionDays(config({ artifactRetentionDays: 14 }), 7);

    expect(commandRetentionDays).toBe(7);
  }

  it('lets a --days override win over config', letsADaysOverrideWinOverPiece);

  function fallsBackToTheDefaultWhenAutoIsDisabled0AnExplicitPruneStillDoesSomething() {
    const commandRetentionDays = readCommandRetentionDays(config({ artifactRetentionDays: 0 }));
    expect(commandRetentionDays).toBe(DEFAULT_RETENTION_DAYS);
  }

  it(
    'falls back to the default when auto is disabled (0) - an explicit prune still does something',
    fallsBackToTheDefaultWhenAutoIsDisabled0AnExplicitPruneStillDoesSomething,
  );

  function defaultsTo30WhenNothingIsConfiguredOrPassed() {
    const commandRetentionDays = readCommandRetentionDays(config());
    expect(commandRetentionDays).toBe(DEFAULT_RETENTION_DAYS);
  }

  it(
    'defaults to 30 when nothing is configured or passed',
    defaultsTo30WhenNothingIsConfiguredOrPassed,
  );
}

describe(
  'readCommandRetentionDays - the explicit `builds prune` window',
  describeResolveCommandRetentionDaysTheExplicitBuildsPruneWindow,
);

function describeReadArtifactIndexWriteArtifactIndexIndexIORoundTrip() {
  let dir: string;
  let indexPath: string;

  function prepareReadArtifactIndexWriteArtifactIndexIndexIORoundTrip() {
    const systemTemporaryDirectory = tmpdir();
    const launchIndexPath = join(systemTemporaryDirectory, 'launch-index-');
    dir = mkdtempSync(launchIndexPath);
    indexPath = join(dir, 'index.json');
  }

  beforeEach(prepareReadArtifactIndexWriteArtifactIndexIndexIORoundTrip);

  function cleanupReadArtifactIndexWriteArtifactIndexIndexIORoundTrip() {
    rmSync(dir, { recursive: true, force: true });
  }

  afterEach(cleanupReadArtifactIndexWriteArtifactIndexIndexIORoundTrip);

  async function returnsForAMissingIndex() {
    const artifactIndex = readArtifactIndex(indexPath);
    const artifactEffect = await runArtifactEffect(artifactIndex);
    expect(artifactEffect).toEqual([]);
  }

  it('returns [] for a missing index', returnsForAMissingIndex);

  async function rejectsAMalformedIndex() {
    writeFileSync(indexPath, '{ not json');
    const artifactIndex = readArtifactIndex(indexPath);
    const artifactEffect = runArtifactEffect(artifactIndex);
    await expect(artifactEffect).rejects.toThrow();
  }

  it('rejects a malformed index', rejectsAMalformedIndex);

  async function roundTripsAWrittenIndex() {
    const artifactIndex = [artifact({ buildNumber: 9 }), artifact({ buildNumber: 7 })];
    await runArtifactEffect(writeArtifactIndex(artifactIndex, indexPath));
    const artifactEffect = await runArtifactEffect(readArtifactIndex(indexPath));
    expect(artifactEffect).toEqual(artifactIndex);
  }

  it('round-trips a written index', roundTripsAWrittenIndex);
}

describe(
  'readArtifactIndex / writeArtifactIndex - index I/O round-trip',
  describeReadArtifactIndexWriteArtifactIndexIndexIORoundTrip,
);

function describeRunArtifactPruneExecutesThePlanAgainstARealIndexBinaries() {
  let dir: string;
  let indexPath: string;

  /** Write a `bytes`-sized fake binary in the temp dir and return its absolute path. */
  function makeBinary(name: string, bytes: number): string {
    const binaryPath = join(dir, name);
    writeFileSync(binaryPath, Buffer.alloc(bytes));
    return binaryPath;
  }

  function prepareRunArtifactPruneExecutesThePlanAgainstARealIndexBinaries() {
    const systemTemporaryDirectory = tmpdir();
    const launchPrunePath = join(systemTemporaryDirectory, 'launch-prune-');
    dir = mkdtempSync(launchPrunePath);
    indexPath = join(dir, 'index.json');
  }

  beforeEach(prepareRunArtifactPruneExecutesThePlanAgainstARealIndexBinaries);

  function cleanupRunArtifactPruneExecutesThePlanAgainstARealIndexBinaries() {
    rmSync(dir, { recursive: true, force: true });
  }

  afterEach(cleanupRunArtifactPruneExecutesThePlanAgainstARealIndexBinaries);

  async function deletesTheOldBinaryKeepsTheNewestStampsPrunedAtAndReportsFreedBytes() {
    const newestPath = makeBinary('newest.ipa', 100);
    const oldPath = makeBinary('old.ipa', 4000);
    const pastDate = daysAgo(2);
    const newest = artifact({ buildNumber: 9, createdAt: pastDate, path: newestPath });
    const old = artifact({ buildNumber: 7, createdAt: daysAgo(40), path: oldPath });
    const artifactIndex = writeArtifactIndex([newest, old], indexPath);

    await runArtifactEffect(artifactIndex);

    const artifactPrune = runArtifactPrune({ now: NOW, retentionDays: 30, indexPath });
    const pruneSummary = await runArtifactEffect(artifactPrune);

    expect(pruneSummary.dryRun).toBe(false);
    expect(pruneSummary.pruned).toHaveLength(1);
    expect(pruneSummary.pruned[0]).toMatchObject({ buildNumber: 7, bytes: 4000 });
    expect(pruneSummary.freedBytes).toBe(4000);

    const pathExists = existsSync(oldPath);

    expect(pathExists).toBe(false); // binary gone
    expect(existsSync(newestPath)).toBe(true); // newest survives

    const writtenArtifacts = await runArtifactEffect(readArtifactIndex(indexPath));

    function isBuildSeven(buildArtifact: BuildArtifact) {
      return buildArtifact.buildNumber == 7;
    }

    expect(writtenArtifacts.find(isBuildSeven)?.prunedAt).toBe(new Date(NOW).toISOString());

    function isBuildNine(buildArtifact: BuildArtifact) {
      return buildArtifact.buildNumber == 9;
    }

    expect(writtenArtifacts.find(isBuildNine)?.prunedAt).toBeUndefined();
  }

  it(
    'deletes the old binary, keeps the newest, stamps prunedAt, and reports freed bytes',
    deletesTheOldBinaryKeepsTheNewestStampsPrunedAtAndReportsFreedBytes,
  );

  async function dryRunDeletesNothingAndLeavesTheIndexUntouched() {
    const newestPath = makeBinary('newest.ipa', 100);
    const oldPath = makeBinary('old.ipa', 4000);
    const pastDate = daysAgo(2);
    const artifactIndex = [
      artifact({ buildNumber: 9, createdAt: pastDate, path: newestPath }),
      artifact({ buildNumber: 7, createdAt: daysAgo(40), path: oldPath }),
    ];

    await runArtifactEffect(writeArtifactIndex(artifactIndex, indexPath));

    const artifactPrune = runArtifactPrune({
      now: NOW,
      retentionDays: 30,
      dryRun: true,
      indexPath,
    });
    const pruneSummary = await runArtifactEffect(artifactPrune);

    expect(pruneSummary.dryRun).toBe(true);
    expect(pruneSummary.pruned).toHaveLength(1);
    expect(pruneSummary.freedBytes).toBe(4000);

    const pathExists = existsSync(oldPath);

    expect(pathExists).toBe(true); // nothing deleted

    const artifactEffect = await runArtifactEffect(readArtifactIndex(indexPath));

    expect(artifactEffect).toEqual(artifactIndex); // index unchanged
  }

  it(
    'dry-run deletes nothing and leaves the index untouched',
    dryRunDeletesNothingAndLeavesTheIndexUntouched,
  );

  async function isANoOpNoIndexWriteWhenNothingIsEligible() {
    const binaryPath = makeBinary('only.ipa', 100);
    const pastDate = daysAgo(2);
    const artifactIndex = writeArtifactIndex(
      [artifact({ buildNumber: 9, createdAt: pastDate, path: binaryPath })],
      indexPath,
    );

    await runArtifactEffect(artifactIndex);

    const indexSourceBeforePrune = readFileSync(indexPath, 'utf8');
    const artifactPrune = runArtifactPrune({ now: NOW, retentionDays: 30, indexPath });
    const pruneSummary = await runArtifactEffect(artifactPrune);

    expect(pruneSummary.pruned).toEqual([]);
    expect(pruneSummary.freedBytes).toBe(0);

    const loadedFile = readFileSync(indexPath, 'utf8');

    expect(loadedFile).toBe(indexSourceBeforePrune); // byte-identical: not rewritten
  }

  it(
    'is a no-op (no index write) when nothing is eligible',
    isANoOpNoIndexWriteWhenNothingIsEligible,
  );

  async function stillRecordsAPruneWhenTheBinaryIsAlreadyMissingUsesTheRecordedSize() {
    const newestPath = makeBinary('newest.ipa', 100);
    const pastDate = daysAgo(2);
    const newest = artifact({ buildNumber: 9, createdAt: pastDate, path: newestPath });
    const missingPath = join(dir, 'missing.ipa');
    const old = artifact({
      buildNumber: 7,
      createdAt: daysAgo(40),
      path: missingPath, // never created
      sizeReport: { artifactBytes: 555, entries: [] },
    });
    const artifactIndex = writeArtifactIndex([newest, old], indexPath);

    await runArtifactEffect(artifactIndex);

    const artifactPrune = runArtifactPrune({ now: NOW, retentionDays: 30, indexPath });
    const pruneSummary = await runArtifactEffect(artifactPrune);

    expect(pruneSummary.freedBytes).toBe(555); // falls back to the recorded artifactBytes

    const writtenArtifacts = await runArtifactEffect(readArtifactIndex(indexPath));

    function isAlsoBuildSeven(buildArtifact: BuildArtifact) {
      return buildArtifact.buildNumber == 7;
    }

    expect(writtenArtifacts.find(isAlsoBuildSeven)?.prunedAt).toBeDefined();
  }

  it(
    'still records a prune when the binary is already missing (uses the recorded size)',
    stillRecordsAPruneWhenTheBinaryIsAlreadyMissingUsesTheRecordedSize,
  );
}

describe(
  'runArtifactPrune - executes the plan against a real index + binaries',
  describeRunArtifactPruneExecutesThePlanAgainstARealIndexBinaries,
);
