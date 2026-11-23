import { describe, it, expect } from 'vitest';
import {
  autoUpgradeBlockedReason,
  isNewer,
  maybeAutoUpgrade,
  shouldCheck,
  type GlobalInstaller,
  type UpdateCheckDeps,
  type UpdateState,
  type UpgradeResult,
} from './update-check.ts';
function describeIsNewer() {
  function comparesDottedVersionsNumerically() {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.1.10', '0.1.2')).toBe(true);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
  }

  it('compares dotted versions numerically', comparesDottedVersionsNumerically);
  function toleratesALeadingVAndAPreReleaseSuffix() {
    expect(isNewer('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.2.0-beta.1', '0.1.0')).toBe(true);
  }

  it('tolerates a leading v and a pre-release suffix', toleratesALeadingVAndAPreReleaseSuffix);
}

describe('isNewer', describeIsNewer);
function describeShouldCheck() {
  const DAY = 24 * 60 * 60 * 1000;
  function checksWhenThereSNoPriorPiece() {
    expect(shouldCheck(DAY, null)).toBe(true);
  }

  it("checks when there's no prior state", checksWhenThereSNoPriorPiece);
  function skipsWithinTheIntervalAndResumesAfterIt() {
    expect(shouldCheck(DAY + 1000, { lastCheckedAt: DAY })).toBe(false);
    expect(shouldCheck(DAY + DAY, { lastCheckedAt: DAY })).toBe(true);
  }

  it('skips within the interval and resumes after it', skipsWithinTheIntervalAndResumesAfterIt);
}

describe('shouldCheck', describeShouldCheck);
function describeAutoUpgradeBlockedReason() {
  const base = {
    environmentVariables: {},
    isTTY: true,
    scriptPath: '/usr/local/lib/node_modules/launch-store/dist/cli/index.js',
  };
  function allowsAnInteractiveInstalledNonCIRun() {
    expect(autoUpgradeBlockedReason(base)).toBeNull();
  }

  it('allows an interactive, installed, non-CI run', allowsAnInteractiveInstalledNonCIRun);
  function blocksTheReExecChildLoopGuard() {
    expect(
      autoUpgradeBlockedReason({ ...base, environmentVariables: { LAUNCH_UPGRADED: '1' } }),
    ).toMatch(/loop guard/);
  }

  it('blocks the re-exec child (loop guard)', blocksTheReExecChildLoopGuard);
  function blocksOnExplicitOptOutCINonTTYAndDevPieceRuns() {
    expect(
      autoUpgradeBlockedReason({ ...base, environmentVariables: { LAUNCH_NO_UPGRADE: '1' } }),
    ).toMatch(/LAUNCH_NO_UPGRADE/);
    expect(autoUpgradeBlockedReason({ ...base, environmentVariables: { CI: 'true' } })).toMatch(
      /CI/,
    );
    expect(autoUpgradeBlockedReason({ ...base, isTTY: false })).toMatch(/interactive/);
    expect(autoUpgradeBlockedReason({ ...base, scriptPath: '/repo/src/cli/index.ts' })).toMatch(
      /dev/,
    );
  }

  it(
    'blocks on explicit opt-out, CI, non-TTY, and dev (source) runs',
    blocksOnExplicitOptOutCINonTTYAndDevPieceRuns,
  );
}

describe('autoUpgradeBlockedReason', describeAutoUpgradeBlockedReason);
/** Build fully-injected deps over recorded call counters; overrides tweak individual behaviors. */
function makeDeps(overrides: Partial<UpdateCheckDeps> = {}): {
  deps: UpdateCheckDeps;
  calls: {
    fetch: number;
    resolveInstaller: number;
    upgrade: number;
    reexec: number;
    writes: UpdateState[];
    notes: string[];
  };
} {
  const calls: {
    fetch: number;
    resolveInstaller: number;
    upgrade: number;
    reexec: number;
    writes: UpdateState[];
    notes: string[];
  } = {
    fetch: 0,
    resolveInstaller: 0,
    upgrade: 0,
    reexec: 0,
    writes: [],
    notes: [],
  };
  const deps: UpdateCheckDeps = {
    now() {
      return 10000000000;
    },
    currentVersion: '0.1.0',
    environmentVariables: {},
    isTTY: true,
    scriptPath: '/usr/local/lib/node_modules/launch-store/dist/cli/index.js',
    async resolveInstaller(): Promise<GlobalInstaller | null> {
      calls.resolveInstaller += 1;

      return 'npm';
    },
    readState() {
      return null;
    },
    async writeState(state) {
      calls.writes.push(state);
    },
    async fetchLatest() {
      calls.fetch += 1;

      return '0.2.0';
    },
    async upgrade(): Promise<UpgradeResult> {
      calls.upgrade += 1;

      return 'upgraded';
    },
    async reexec() {
      calls.reexec += 1;
    },
    async notify(message) {
      calls.notes.push(message);
    },
    ...overrides,
  };
  return { deps, calls };
}
function describeMaybeAutoUpgrade() {
  async function doesNothingWhenBlockedEGCINoFetchNoUpgrade() {
    const { deps, calls } = makeDeps({ environmentVariables: { CI: '1' } });
    await maybeAutoUpgrade(deps);
    expect(calls.fetch).toBe(0);
    expect(calls.upgrade).toBe(0);
  }

  it(
    'does nothing when blocked (e.g. CI) - no fetch, no upgrade',
    doesNothingWhenBlockedEGCINoFetchNoUpgrade,
  );
  async function doesNothingWhenCheckedRecentlyThrottled() {
    const { deps, calls } = makeDeps({
      readState() {
        return { lastCheckedAt: 10000000000 };
      },
    });
    await maybeAutoUpgrade(deps);
    expect(calls.fetch).toBe(0);
  }

  it('does nothing when checked recently (throttled)', doesNothingWhenCheckedRecentlyThrottled);
  async function recordsTheCheckButDoesnTUpgradeWhenAlreadyCurrent() {
    const { deps, calls } = makeDeps({
      async fetchLatest() {
        return '0.1.0';
      },
    });
    await maybeAutoUpgrade(deps);
    expect(calls.writes).toHaveLength(1);
    expect(calls.resolveInstaller).toBe(0);
    expect(calls.upgrade).toBe(0);
    expect(calls.reexec).toBe(0);
  }

  it(
    "records the check but doesn't upgrade when already current",
    recordsTheCheckButDoesnTUpgradeWhenAlreadyCurrent,
  );
  async function upgradesAndReExecsWhenANewerVersionExists() {
    const { deps, calls } = makeDeps();
    await maybeAutoUpgrade(deps);
    expect(calls.upgrade).toBe(1);
    expect(calls.reexec).toBe(1);
  }

  it(
    'upgrades and re-execs when a newer version exists',
    upgradesAndReExecsWhenANewerVersionExists,
  );
  async function notifiesAndDoesNotReExecWhenTheGlobalDirIsnTWritable() {
    const { deps, calls } = makeDeps({
      async upgrade() {
        return 'eacces';
      },
    });
    await maybeAutoUpgrade(deps);
    expect(calls.reexec).toBe(0);
    function someNote(note: string) {
      return note.includes('sudo npm install -g');
    }

    expect(calls.notes.some(someNote)).toBe(true);
  }

  it(
    "notifies (and does not re-exec) when the global dir isn't writable",
    notifiesAndDoesNotReExecWhenTheGlobalDirIsnTWritable,
  );
  async function upgradesRelaunchesAndNamesPnpmForAPnpmInstall() {
    const usedInstallers: GlobalInstaller[] = [];
    const { deps, calls } = makeDeps({
      async resolveInstaller() {
        return 'pnpm';
      },
      async upgrade(installer) {
        usedInstallers.push(installer);

        return 'failed';
      },
    });
    await maybeAutoUpgrade(deps);
    expect(usedInstallers).toEqual(['pnpm']);
    expect(calls.reexec).toBe(0);
    expect(calls.notes).toEqual([
      'launch-store 0.2.0 is available - pnpm add -g launch-store@0.2.0',
    ]);
  }

  it(
    'upgrades, relaunches, and names pnpm for a pnpm install',
    upgradesRelaunchesAndNamesPnpmForAPnpmInstall,
  );
  async function onlyNotifiesForAProjectOrNpxInstall() {
    const { deps, calls } = makeDeps({
      async resolveInstaller() {
        return null;
      },
    });
    await maybeAutoUpgrade(deps);
    expect(calls.upgrade).toBe(0);
    expect(calls.reexec).toBe(0);
    expect(calls.notes).toEqual(['launch-store 0.2.0 is available - you have 0.1.0']);
  }

  it('only notifies for a project or npx install', onlyNotifiesForAProjectOrNpxInstall);
  async function recordsTheCheckAndStaysQuietWhenOfflineFetchReturnsNull() {
    const { deps, calls } = makeDeps({
      async fetchLatest() {
        return null;
      },
    });
    await maybeAutoUpgrade(deps);
    expect(calls.writes).toHaveLength(1);
    expect(calls.upgrade).toBe(0);
  }

  it(
    'records the check and stays quiet when offline (fetch returns null)',
    recordsTheCheckAndStaysQuietWhenOfflineFetchReturnsNull,
  );
}

describe('maybeAutoUpgrade', describeMaybeAutoUpgrade);
