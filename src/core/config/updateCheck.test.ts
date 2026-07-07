/**
 * Tests for the silent self-upgrade. The pure pieces (version compare, throttle, guardrails) are
 * checked directly; the {@link maybeAutoUpgrade} orchestration runs against fully-injected deps so
 * every branch — blocked, throttled, up-to-date, newer, EACCES, offline — is exercised with no real
 * network, npm, or process replacement.
 */

import { describe, it, expect } from 'vitest';
import {
  autoUpgradeBlockedReason,
  isNewer,
  maybeAutoUpgrade,
  shouldCheck,
  type UpdateCheckDeps,
  type UpdateState,
  type UpgradeResult,
} from './updateCheck.js';

describe('isNewer', () => {
  it('compares dotted versions numerically', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.1.10', '0.1.2')).toBe(true);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
  });

  it('tolerates a leading v and a pre-release suffix', () => {
    expect(isNewer('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.2.0-beta.1', '0.1.0')).toBe(true);
  });
});

describe('shouldCheck', () => {
  const DAY = 24 * 60 * 60 * 1000;
  it("checks when there's no prior state", () => {
    expect(shouldCheck(DAY, null)).toBe(true);
  });
  it('skips within the interval and resumes after it', () => {
    expect(shouldCheck(DAY + 1000, { lastCheckedAt: DAY })).toBe(false);
    expect(shouldCheck(DAY + DAY, { lastCheckedAt: DAY })).toBe(true);
  });
});

describe('autoUpgradeBlockedReason', () => {
  const base = {
    env: {} as NodeJS.ProcessEnv,
    isTTY: true,
    scriptPath: '/usr/local/lib/node_modules/launch-store/dist/cli/index.js',
  };
  it('allows an interactive, installed, non-CI run', () => {
    expect(autoUpgradeBlockedReason(base)).toBeNull();
  });
  it('blocks the re-exec child (loop guard)', () => {
    expect(autoUpgradeBlockedReason({ ...base, env: { LAUNCH_UPGRADED: '1' } })).toMatch(
      /loop guard/,
    );
  });
  it('blocks on explicit opt-out, CI, non-TTY, and dev (source) runs', () => {
    expect(autoUpgradeBlockedReason({ ...base, env: { LAUNCH_NO_UPGRADE: '1' } })).toMatch(
      /LAUNCH_NO_UPGRADE/,
    );
    expect(autoUpgradeBlockedReason({ ...base, env: { CI: 'true' } })).toMatch(/CI/);
    expect(autoUpgradeBlockedReason({ ...base, isTTY: false })).toMatch(/interactive/);
    expect(autoUpgradeBlockedReason({ ...base, scriptPath: '/repo/src/cli/index.ts' })).toMatch(
      /dev/,
    );
  });
});

/** Build fully-injected deps over recorded call counters; overrides tweak individual behaviors. */
function makeDeps(overrides: Partial<UpdateCheckDeps> = {}): {
  deps: UpdateCheckDeps;
  calls: { fetch: number; upgrade: number; reexec: number; writes: UpdateState[]; notes: string[] };
} {
  const calls = {
    fetch: 0,
    upgrade: 0,
    reexec: 0,
    writes: [] as UpdateState[],
    notes: [] as string[],
  };
  const deps: UpdateCheckDeps = {
    now: () => 10_000_000_000,
    currentVersion: '0.1.0',
    env: {},
    isTTY: true,
    scriptPath: '/usr/local/lib/node_modules/launch-store/dist/cli/index.js',
    readState: () => null,
    writeState: (state) => calls.writes.push(state),
    fetchLatest: async () => {
      calls.fetch++;
      return '0.2.0';
    },
    upgrade: async (): Promise<UpgradeResult> => {
      calls.upgrade++;
      return 'upgraded';
    },
    reexec: () => {
      calls.reexec++;
    },
    notify: (message) => calls.notes.push(message),
    ...overrides,
  };
  return { deps, calls };
}

describe('maybeAutoUpgrade', () => {
  it('does nothing when blocked (e.g. CI) — no fetch, no upgrade', async () => {
    const { deps, calls } = makeDeps({ env: { CI: '1' } });
    await maybeAutoUpgrade(deps);
    expect(calls.fetch).toBe(0);
    expect(calls.upgrade).toBe(0);
  });

  it('does nothing when checked recently (throttled)', async () => {
    const { deps, calls } = makeDeps({ readState: () => ({ lastCheckedAt: 10_000_000_000 }) });
    await maybeAutoUpgrade(deps);
    expect(calls.fetch).toBe(0);
  });

  it("records the check but doesn't upgrade when already current", async () => {
    const { deps, calls } = makeDeps({ fetchLatest: async () => '0.1.0' });
    await maybeAutoUpgrade(deps);
    expect(calls.writes).toHaveLength(1);
    expect(calls.upgrade).toBe(0);
    expect(calls.reexec).toBe(0);
  });

  it('upgrades and re-execs when a newer version exists', async () => {
    const { deps, calls } = makeDeps();
    await maybeAutoUpgrade(deps);
    expect(calls.upgrade).toBe(1);
    expect(calls.reexec).toBe(1);
  });

  it("notifies (and does not re-exec) when the global dir isn't writable", async () => {
    const { deps, calls } = makeDeps({ upgrade: async () => 'eacces' });
    await maybeAutoUpgrade(deps);
    expect(calls.reexec).toBe(0);
    expect(calls.notes.some((note) => note.includes('sudo npm i -g'))).toBe(true);
  });

  it('records the check and stays quiet when offline (fetch returns null)', async () => {
    const { deps, calls } = makeDeps({ fetchLatest: async () => null });
    await maybeAutoUpgrade(deps);
    expect(calls.writes).toHaveLength(1);
    expect(calls.upgrade).toBe(0);
  });
});
